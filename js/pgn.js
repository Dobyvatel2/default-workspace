/* Gambit PGN reader — parses main lines, annotations, clocks and NAGs. */
(function (global) {
  'use strict';

  var Chess = global.ChessCore;
  var HEADER_ORDER = [
    'Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result',
    'WhiteElo', 'BlackElo', 'WhiteTitle', 'BlackTitle', 'ECO', 'Opening',
    'Variation', 'Annotator', 'FEN', 'SetUp'
  ];
  var NAG_TEXT = {
    1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!',
    7: '□', 10: '=', 13: '∞', 14: '⩲', 15: '⩱', 16: '±', 17: '∓',
    18: '+−', 19: '−+', 22: '⨀', 23: '⨀', 32: '⟳', 36: '↑', 40: '→'
  };

  function unescapeHeader(value) {
    return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  function escapeHeader(value) {
    return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function normalizeComment(raw) {
    var clockMatch = raw.match(/\[%clk\s+([^\]]+)\]/i);
    var evalMatch = raw.match(/\[%eval\s+([^\]]+)\]/i);
    var clean = raw
      .replace(/\[%[^\]]*\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      raw: raw,
      clean: clean,
      clock: clockMatch ? clockMatch[1].trim() : null,
      eval: evalMatch ? evalMatch[1].trim() : null
    };
  }

  function tokenize(text) {
    var tokens = [];
    var i = 0;
    var n = text.length;

    while (i < n) {
      var c = text[i];

      if (/\s/.test(c)) {
        i++;
        continue;
      }

      if (c === '[') {
        var lineEnd = text.indexOf('\n', i);
        if (lineEnd === -1) lineEnd = n;
        var line = text.slice(i, lineEnd).replace(/\r$/, '').trim();
        var headerMatch = line.match(/^\[\s*([A-Za-z][A-Za-z0-9_]*)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/);
        if (headerMatch) {
          tokens.push({
            type: 'header',
            key: headerMatch[1],
            value: unescapeHeader(headerMatch[2])
          });
          i = lineEnd;
          continue;
        }
        i++;
        continue;
      }

      if (c === '{') {
        var close = text.indexOf('}', i + 1);
        if (close === -1) close = n;
        tokens.push({
          type: 'comment',
          value: text.slice(i + 1, close).trim()
        });
        i = close < n ? close + 1 : n;
        continue;
      }

      if (c === ';') {
        var commentEnd = text.indexOf('\n', i);
        if (commentEnd === -1) commentEnd = n;
        var value = text.slice(i + 1, commentEnd).trim();
        if (value) tokens.push({ type: 'comment', value: value });
        i = commentEnd;
        continue;
      }

      if (c === '(') {
        tokens.push({ type: 'open' });
        i++;
        continue;
      }

      if (c === ')') {
        tokens.push({ type: 'close' });
        i++;
        continue;
      }

      if (c === '$') {
        var nagEnd = i + 1;
        while (nagEnd < n && /\d/.test(text[nagEnd])) nagEnd++;
        var nag = Number(text.slice(i + 1, nagEnd));
        if (Number.isFinite(nag)) tokens.push({ type: 'nag', value: nag });
        i = nagEnd;
        continue;
      }

      if (c === '*') {
        tokens.push({ type: 'result', value: '*' });
        i++;
        continue;
      }

      if (c === '.') {
        i++;
        continue;
      }

      var start = i;
      while (i < n && !/[\s{}();]/.test(text[i])) i++;
      var word = text.slice(start, i);
      if (!word) {
        i++;
        continue;
      }

      var numberPrefix = word.match(/^(\d+)\.{1,3}(.*)$/);
      if (numberPrefix) {
        word = numberPrefix[2];
        if (!word) continue;
      }

      if (/^\.+$/.test(word)) continue;
      word = word.replace(/^\.+/, '');
      if (!word) continue;

      var resultMatch = word.match(/^(.*?)(1-0|0-1|1\/2-1\/2|\*)$/);
      if (resultMatch) {
        if (resultMatch[1]) tokens.push({ type: 'word', value: resultMatch[1] });
        tokens.push({ type: 'result', value: resultMatch[2] });
        continue;
      }

      if (word === 'e.p.' || word === 'ep' || word === '...') continue;
      tokens.push({ type: 'word', value: word });
    }

    return tokens;
  }

  function parse(text) {
    var games = [];
    var errors = [];
    var source = String(text || '').replace(/^\uFEFF/, '');
    var tokens = tokenize(source);
    var current = null;
    var variationDepth = 0;

    function ensureGame() {
      if (!current) {
        current = {
          headers: {},
          moves: [],
          result: null,
          position: null,
          startPosition: null,
          startFen: null,
          introComment: '',
          variationCount: 0,
          invalid: false,
          error: null
        };
      }
      return current;
    }

    function finalize() {
      if (!current) return;
      var game = current;
      current = null;
      variationDepth = 0;
      if (!game.moves.length) return;
      if (game.invalid) {
        errors.push(game.error || 'The game could not be read.');
        return;
      }
      var result = game.result || game.headers.Result || '*';
      game.result = result;
      game.headers.Result = result;
      game.moveCount = game.moves.length;
      game.pgn = build(game);
      games.push(game);
    }

    for (var index = 0; index < tokens.length; index++) {
      var token = tokens[index];

      if (token.type === 'header') {
        if (current && (current.moves.length > 0 || current.result)) finalize();
        ensureGame();
        current.headers[token.key] = token.value;
        continue;
      }

      if (token.type === 'result') {
        if (!current) continue;
        current.result = token.value;
        continue;
      }

      if (token.type === 'open') {
        if (current) current.variationCount++;
        variationDepth++;
        continue;
      }

      if (token.type === 'close') {
        if (variationDepth > 0) variationDepth--;
        continue;
      }

      if (token.type === 'comment') {
        if (!current || variationDepth > 0) continue;
        var note = normalizeComment(token.value || '');
        if (!note.clean && !note.clock && !note.eval) continue;
        if (!current.moves.length) {
          current.introComment = [current.introComment, note.clean].filter(Boolean).join(' ');
          continue;
        }
        var lastMove = current.moves[current.moves.length - 1];
        lastMove.comment = [lastMove.comment, note.clean].filter(Boolean).join(' ');
        lastMove.rawComment = [lastMove.rawComment, note.raw].filter(Boolean).join(' ');
        if (note.clock) lastMove.clock = note.clock;
        if (note.eval) lastMove.eval = note.eval;
        continue;
      }

      if (token.type === 'nag') {
        if (!current || variationDepth > 0 || !current.moves.length) continue;
        current.moves[current.moves.length - 1].nags.push(token.value);
        continue;
      }

      if (token.type !== 'word') continue;

      if (current && current.result) continue;
      if (current && current.invalid) continue;
      ensureGame();

      if (variationDepth > 0) continue;

      if (!current.position) {
        try {
          if (current.headers.FEN) {
            current.startPosition = Chess.parseFen(current.headers.FEN);
            current.startFen = current.headers.FEN;
          } else {
            current.startPosition = Chess.initialPosition();
            current.startFen = Chess.START_FEN;
          }
          current.position = Chess.clonePosition(current.startPosition);
        } catch (error) {
          current.invalid = true;
          current.error = 'Invalid starting position: ' + error.message;
          continue;
        }
      }

      var before = current.position;
      try {
        var parsed = Chess.parseSan(before, token.value);
        var suffixMatch = String(token.value).match(/(!!|\?\?|!\?|\?!|!|\?)$/);
        var suffixNag = suffixMatch
          ? ({ '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 })[suffixMatch[1]]
          : null;
        var move = {
          ply: current.moves.length + 1,
          moveNumber: before.fullmove,
          color: before.turn,
          san: parsed.san,
          uci: parsed.uci,
          from: parsed.from,
          to: parsed.to,
          promotion: parsed.promotion,
          flag: parsed.flag,
          captured: parsed.captured,
          fenBefore: Chess.toFen(before),
          fenAfter: parsed.fenAfter,
          isCheck: parsed.isCheck,
          isMate: parsed.isMate,
          comment: '',
          rawComment: '',
          nags: suffixNag ? [suffixNag] : [],
          clock: null,
          eval: null
        };
        current.moves.push(move);
        current.position = Chess.makeMove(before, move);
      } catch (error) {
        current.invalid = true;
        current.error = 'Move ' + (current.moves.length + 1) + ' ("' + token.value + '"): ' + error.message;
      }
    }

    finalize();

    return {
      games: games,
      errors: errors,
      source: source
    };
  }

  function build(game) {
    if (!game || !game.moves) return '';
    var headers = {};
    var key;
    for (key in game.headers) {
      if (Object.prototype.hasOwnProperty.call(game.headers, key)) headers[key] = game.headers[key];
    }
    headers.Result = game.result || headers.Result || '*';
    if (headers.FEN) headers.SetUp = headers.SetUp || '1';

    var headerLines = [];
    var used = {};
    HEADER_ORDER.forEach(function (headerKey) {
      if (headers[headerKey] !== undefined && headers[headerKey] !== '') {
        headerLines.push('[' + headerKey + ' "' + escapeHeader(headers[headerKey]) + '"]');
        used[headerKey] = true;
      }
    });
    Object.keys(headers).sort().forEach(function (headerKey) {
      if (used[headerKey] || headers[headerKey] === '') return;
      headerLines.push('[' + headerKey + ' "' + escapeHeader(headers[headerKey]) + '"]');
    });

    var tokens = [];
    if (game.introComment) tokens.push('{' + game.introComment.replace(/}/g, ')') + '}');

    game.moves.forEach(function (move, index) {
      var text;
      if (move.color === 'w') {
        text = move.moveNumber + '. ' + move.san;
      } else if (index === 0 || game.moves[index - 1].color === 'w') {
        text = move.san;
      } else {
        text = move.moveNumber + '... ' + move.san;
      }
      tokens.push(text);
      (move.nags || []).forEach(function (nag) {
        tokens.push('$' + nag);
      });
      var note = move.rawComment || move.comment;
      if (note) tokens.push('{' + String(note).replace(/}/g, ')') + '}');
    });
    tokens.push(headers.Result);

    var lines = [];
    var line = '';
    tokens.forEach(function (token) {
      if (!line) {
        line = token;
      } else if (line.length + token.length + 1 > 88) {
        lines.push(line);
        line = token;
      } else {
        line += ' ' + token;
      }
    });
    if (line) lines.push(line);

    return headerLines.join('\n') + '\n\n' + lines.join('\n') + '\n';
  }

  function nagText(nag) {
    return NAG_TEXT[nag] || '';
  }

  global.PGN = {
    parse: parse,
    build: build,
    tokenize: tokenize,
    nagText: nagText
  };
})(window);

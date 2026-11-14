/* Gambit chess core — a dependency-free legal move generator, FEN and SAN helper.
   Board indices: 0 = a8, 7 = h8, 56 = a1, 63 = h1. */
(function (global) {
  'use strict';

  var FILES = 'abcdefgh';
  var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  var PROMOTION_PIECES = ['Q', 'R', 'B', 'N'];
  var PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  var KNIGHT_DELTAS = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1]
  ];
  var KING_DELTAS = [
    [-1, -1], [-1, 0], [-1, 1], [0, -1],
    [0, 1], [1, -1], [1, 0], [1, 1]
  ];
  var ORTHOGONAL = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  var DIAGONAL = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  function squareToIndex(square) {
    if (typeof square !== 'string' || !/^[a-h][1-8]$/.test(square)) return -1;
    return (8 - Number(square[1])) * 8 + FILES.indexOf(square[0]);
  }

  function indexToSquare(index) {
    if (index < 0 || index > 63) return '';
    return FILES[index % 8] + String(8 - Math.floor(index / 8));
  }

  function colorOf(piece) {
    return piece ? piece[0] : null;
  }

  function typeOf(piece) {
    return piece ? piece[1] : null;
  }

  function opposite(color) {
    return color === 'w' ? 'b' : 'w';
  }

  function onBoard(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
  }

  function initialPosition() {
    return parseFen(START_FEN);
  }

  function emptyPosition() {
    return {
      board: new Array(64).fill(null),
      turn: 'w',
      castling: '',
      ep: -1,
      halfmove: 0,
      fullmove: 1
    };
  }

  function clonePosition(pos) {
    return {
      board: pos.board.slice(),
      turn: pos.turn,
      castling: pos.castling,
      ep: pos.ep,
      halfmove: pos.halfmove,
      fullmove: pos.fullmove
    };
  }

  function parseFen(fen) {
    if (typeof fen !== 'string' || !fen.trim()) {
      throw new Error('Empty FEN.');
    }
    var parts = fen.trim().split(/\s+/);
    if (parts.length < 2) throw new Error('FEN is missing fields.');
    var rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('FEN must have eight ranks.');
    var board = new Array(64).fill(null);

    for (var r = 0; r < 8; r++) {
      var file = 0;
      for (var i = 0; i < rows[r].length; i++) {
        var ch = rows[r][i];
        if (/[1-8]/.test(ch)) {
          file += Number(ch);
        } else if (/[prnbqkPRNBQK]/.test(ch)) {
          if (file > 7) throw new Error('Too many squares in a FEN rank.');
          var color = ch === ch.toUpperCase() ? 'w' : 'b';
          board[r * 8 + file] = color + ch.toUpperCase();
          file++;
        } else {
          throw new Error('Unexpected character in FEN.');
        }
      }
      if (file !== 8) throw new Error('Each FEN rank needs eight squares.');
    }

    var turn = parts[1] === 'b' ? 'b' : 'w';
    var castling = parts[2] && parts[2] !== '-' ? parts[2].replace(/[^KQkq]/g, '') : '';
    var ep = parts[3] && parts[3] !== '-' ? squareToIndex(parts[3]) : -1;
    var halfmove = Number(parts[4]);
    var fullmove = Number(parts[5]);

    return {
      board: board,
      turn: turn,
      castling: castling,
      ep: ep,
      halfmove: Number.isFinite(halfmove) ? halfmove : 0,
      fullmove: Number.isFinite(fullmove) && fullmove > 0 ? fullmove : 1
    };
  }

  function toFen(pos) {
    var rows = [];
    for (var r = 0; r < 8; r++) {
      var row = '';
      var empty = 0;
      for (var f = 0; f < 8; f++) {
        var piece = pos.board[r * 8 + f];
        if (!piece) {
          empty++;
          continue;
        }
        if (empty) {
          row += empty;
          empty = 0;
        }
        row += piece[0] === 'w' ? piece[1] : piece[1].toLowerCase();
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return [
      rows.join('/'),
      pos.turn,
      pos.castling || '-',
      pos.ep >= 0 ? indexToSquare(pos.ep) : '-',
      pos.halfmove || 0,
      pos.fullmove || 1
    ].join(' ');
  }

  function removeCastlingRights(rights, chars) {
    var out = rights || '';
    for (var i = 0; i < chars.length; i++) {
      out = out.replace(chars[i], '');
    }
    return out;
  }

  function makeMove(pos, move) {
    var board = pos.board.slice();
    var piece = board[move.from];
    if (!piece) throw new Error('No piece on the starting square.');
    var color = piece[0];
    var type = piece[1];
    var captureSquare = -1;
    var captured = move.captured || null;

    if (move.flag === 'e') {
      captureSquare = move.to + (color === 'w' ? 8 : -8);
      captured = board[captureSquare] ? board[captureSquare][1] : 'P';
      board[captureSquare] = null;
    } else if (board[move.to]) {
      captured = board[move.to][1];
    }

    board[move.from] = null;
    board[move.to] = color + (move.promotion || type);

    if (move.flag === 'k') {
      if (color === 'w') {
        board[63] = null;
        board[61] = 'wR';
      } else {
        board[7] = null;
        board[5] = 'bR';
      }
    } else if (move.flag === 'q') {
      if (color === 'w') {
        board[56] = null;
        board[59] = 'wR';
      } else {
        board[0] = null;
        board[3] = 'bR';
      }
    }

    var rights = pos.castling || '';
    if (type === 'K') rights = removeCastlingRights(rights, color === 'w' ? 'KQ' : 'kq');
    if (type === 'R') {
      if (move.from === 63) rights = removeCastlingRights(rights, 'K');
      if (move.from === 56) rights = removeCastlingRights(rights, 'Q');
      if (move.from === 7) rights = removeCastlingRights(rights, 'k');
      if (move.from === 0) rights = removeCastlingRights(rights, 'q');
    }
    if (captured === 'R') {
      if (move.to === 63) rights = removeCastlingRights(rights, 'K');
      if (move.to === 56) rights = removeCastlingRights(rights, 'Q');
      if (move.to === 7) rights = removeCastlingRights(rights, 'k');
      if (move.to === 0) rights = removeCastlingRights(rights, 'q');
    }

    var ep = -1;
    if (type === 'P' && Math.abs(move.to - move.from) === 16) {
      ep = (move.from + move.to) / 2;
    }

    return {
      board: board,
      turn: opposite(pos.turn),
      castling: rights,
      ep: ep,
      halfmove: (type === 'P' || captured) ? 0 : (pos.halfmove || 0) + 1,
      fullmove: pos.turn === 'b' ? (pos.fullmove || 1) + 1 : (pos.fullmove || 1)
    };
  }

  function pushPawnMoves(moves, from, to, flag, captured) {
    var rank = Math.floor(to / 8);
    if (rank === 0 || rank === 7) {
      for (var i = 0; i < PROMOTION_PIECES.length; i++) {
        moves.push({
          from: from,
          to: to,
          flag: flag,
          promotion: PROMOTION_PIECES[i],
          captured: captured || null
        });
      }
    } else {
      moves.push({
        from: from,
        to: to,
        flag: flag,
        promotion: null,
        captured: captured || null
      });
    }
  }

  function generatePseudoMoves(pos, color) {
    color = color || pos.turn;
    var board = pos.board;
    var moves = [];

    for (var from = 0; from < 64; from++) {
      var piece = board[from];
      if (!piece || piece[0] !== color) continue;
      var type = piece[1];
      var row = Math.floor(from / 8);
      var col = from % 8;
      var i, dr, dc, nr, nc, to, target, step;

      if (type === 'P') {
        var dir = color === 'w' ? -1 : 1;
        var startRank = color === 'w' ? 6 : 1;
        var nr1 = row + dir;

        if (onBoard(nr1, col) && !board[nr1 * 8 + col]) {
          pushPawnMoves(moves, from, nr1 * 8 + col, 'n', null);
          var nr2 = row + dir * 2;
          if (row === startRank && !board[nr2 * 8 + col]) {
            moves.push({ from: from, to: nr2 * 8 + col, flag: 'b', promotion: null, captured: null });
          }
        }

        for (var dcP = -1; dcP <= 1; dcP += 2) {
          var ncP = col + dcP;
          if (!onBoard(nr1, ncP)) continue;
          to = nr1 * 8 + ncP;
          target = board[to];
          if (target && target[0] !== color) {
            pushPawnMoves(moves, from, to, 'c', target[1]);
          } else if (to === pos.ep) {
            pushPawnMoves(moves, from, to, 'e', 'P');
          }
        }
        continue;
      }

      if (type === 'N' || type === 'K') {
        var deltas = type === 'N' ? KNIGHT_DELTAS : KING_DELTAS;
        for (i = 0; i < deltas.length; i++) {
          nr = row + deltas[i][0];
          nc = col + deltas[i][1];
          if (!onBoard(nr, nc)) continue;
          to = nr * 8 + nc;
          target = board[to];
          if (!target || target[0] !== color) {
            moves.push({ from: from, to: to, flag: 'n', promotion: null, captured: target ? target[1] : null });
          }
        }
        continue;
      }

      var directions = type === 'B' ? DIAGONAL : type === 'R' ? ORTHOGONAL : DIAGONAL.concat(ORTHOGONAL);
      for (i = 0; i < directions.length; i++) {
        dr = directions[i][0];
        dc = directions[i][1];
        nr = row + dr;
        nc = col + dc;
        while (onBoard(nr, nc)) {
          to = nr * 8 + nc;
          target = board[to];
          if (!target) {
            moves.push({ from: from, to: to, flag: 'n', promotion: null, captured: null });
          } else {
            if (target[0] !== color) {
              moves.push({ from: from, to: to, flag: 'n', promotion: null, captured: target[1] });
            }
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
    }

    // Castling is generated last so king moves are already present.
    var enemy = opposite(color);
    var kingSquare = color === 'w' ? 60 : 4;
    var kingSide = color === 'w' ? 'K' : 'k';
    var queenSide = color === 'w' ? 'Q' : 'q';
    if (board[kingSquare] === color + 'K' && !isSquareAttacked(board, kingSquare, enemy)) {
      if ((pos.castling || '').indexOf(kingSide) !== -1) {
        var rookSquare = color === 'w' ? 63 : 7;
        var kingPathA = color === 'w' ? 61 : 5;
        var kingPathB = color === 'w' ? 62 : 6;
        if (!board[kingPathA] && !board[kingPathB] && board[rookSquare] === color + 'R' &&
            !isSquareAttacked(board, kingPathA, enemy) && !isSquareAttacked(board, kingPathB, enemy)) {
          moves.push({ from: kingSquare, to: kingPathB, flag: 'k', promotion: null, captured: null });
        }
      }
      if ((pos.castling || '').indexOf(queenSide) !== -1) {
        var rookSquareQ = color === 'w' ? 56 : 0;
        var queenPathA = color === 'w' ? 59 : 3;
        var queenPathB = color === 'w' ? 58 : 2;
        var queenPathC = color === 'w' ? 57 : 1;
        if (!board[queenPathA] && !board[queenPathB] && !board[queenPathC] &&
            board[rookSquareQ] === color + 'R' &&
            !isSquareAttacked(board, queenPathA, enemy) && !isSquareAttacked(board, queenPathB, enemy)) {
          moves.push({ from: kingSquare, to: queenPathB, flag: 'q', promotion: null, captured: null });
        }
      }
    }

    return moves;
  }

  function findKing(board, color) {
    var target = color + 'K';
    for (var i = 0; i < 64; i++) {
      if (board[i] === target) return i;
    }
    return -1;
  }

  function isSquareAttacked(board, square, byColor) {
    if (square < 0) return false;
    var row = Math.floor(square / 8);
    var col = square % 8;
    var i, r, c;

    var pawnRow = row + (byColor === 'w' ? 1 : -1);
    if (pawnRow >= 0 && pawnRow < 8) {
      for (var dc = -1; dc <= 1; dc += 2) {
        c = col + dc;
        if (c >= 0 && c < 8 && board[pawnRow * 8 + c] === byColor + 'P') return true;
      }
    }

    for (i = 0; i < KNIGHT_DELTAS.length; i++) {
      r = row + KNIGHT_DELTAS[i][0];
      c = col + KNIGHT_DELTAS[i][1];
      if (onBoard(r, c) && board[r * 8 + c] === byColor + 'N') return true;
    }

    for (i = 0; i < KING_DELTAS.length; i++) {
      r = row + KING_DELTAS[i][0];
      c = col + KING_DELTAS[i][1];
      if (onBoard(r, c) && board[r * 8 + c] === byColor + 'K') return true;
    }

    for (i = 0; i < ORTHOGONAL.length; i++) {
      r = row + ORTHOGONAL[i][0];
      c = col + ORTHOGONAL[i][1];
      while (onBoard(r, c)) {
        var piece = board[r * 8 + c];
        if (piece) {
          if (piece[0] === byColor && (piece[1] === 'R' || piece[1] === 'Q')) return true;
          break;
        }
        r += ORTHOGONAL[i][0];
        c += ORTHOGONAL[i][1];
      }
    }

    for (i = 0; i < DIAGONAL.length; i++) {
      r = row + DIAGONAL[i][0];
      c = col + DIAGONAL[i][1];
      while (onBoard(r, c)) {
        var diagPiece = board[r * 8 + c];
        if (diagPiece) {
          if (diagPiece[0] === byColor && (diagPiece[1] === 'B' || diagPiece[1] === 'Q')) return true;
          break;
        }
        r += DIAGONAL[i][0];
        c += DIAGONAL[i][1];
      }
    }

    return false;
  }

  function isInCheck(pos, color) {
    var square = findKing(pos.board, color || pos.turn);
    return isSquareAttacked(pos.board, square, opposite(color || pos.turn));
  }

  function generateLegalMoves(pos) {
    var color = pos.turn;
    var pseudo = generatePseudoMoves(pos, color);
    var legal = [];
    for (var i = 0; i < pseudo.length; i++) {
      var next = makeMove(pos, pseudo[i]);
      if (!isInCheck(next, color)) legal.push(pseudo[i]);
    }
    return legal;
  }

  function moveToUci(move) {
    return indexToSquare(move.from) + indexToSquare(move.to) + (move.promotion ? move.promotion.toLowerCase() : '');
  }

  function moveToSan(pos, move, legalMoves) {
    var legal = legalMoves || generateLegalMoves(pos);
    var piece = pos.board[move.from];
    if (!piece) return '';
    var type = piece[1];

    if (move.flag === 'k') {
      var castleSan = 'O-O';
      var castleNext = makeMove(pos, move);
      if (isInCheck(castleNext, castleNext.turn)) {
        castleSan += generateLegalMoves(castleNext).length === 0 ? '#' : '+';
      }
      return castleSan;
    }
    if (move.flag === 'q') {
      var queenSan = 'O-O-O';
      var queenNext = makeMove(pos, move);
      if (isInCheck(queenNext, queenNext.turn)) {
        queenSan += generateLegalMoves(queenNext).length === 0 ? '#' : '+';
      }
      return queenSan;
    }

    var san = '';
    var isCapture = !!move.captured;
    var destination = indexToSquare(move.to);

    if (type === 'P') {
      if (isCapture) san += FILES[move.from % 8] + 'x';
      san += destination;
      if (move.promotion) san += '=' + move.promotion;
    } else {
      san += type;
      var alternatives = legal.filter(function (candidate) {
        return candidate.from !== move.from &&
          candidate.to === move.to &&
          pos.board[candidate.from] &&
          pos.board[candidate.from][1] === type;
      });
      if (alternatives.length) {
        var fromFile = FILES[move.from % 8];
        var fromRank = String(8 - Math.floor(move.from / 8));
        var sharesFile = alternatives.some(function (candidate) {
          return FILES[candidate.from % 8] === fromFile;
        });
        var sharesRank = alternatives.some(function (candidate) {
          return String(8 - Math.floor(candidate.from / 8)) === fromRank;
        });
        if (!sharesFile) san += fromFile;
        else if (!sharesRank) san += fromRank;
        else san += fromFile + fromRank;
      }
      if (isCapture) san += 'x';
      san += destination;
    }

    var next = makeMove(pos, move);
    if (isInCheck(next, next.turn)) {
      san += generateLegalMoves(next).length === 0 ? '#' : '+';
    }
    return san;
  }

  function parseSan(pos, sanText) {
    if (!sanText) throw new Error('Empty move.');
    var cleaned = String(sanText).trim()
      .replace(/[!?]+$/g, '')
      .replace(/[+#]+$/g, '')
      .replace(/0/g, 'O')
      .replace(/e\.p\./gi, '');

    if (!cleaned) throw new Error('Empty move.');
    if (cleaned === '--') throw new Error('Null moves are not supported.');

    var legal = generateLegalMoves(pos);

    if (cleaned === 'O-O' || cleaned === 'O-O-O') {
      var flag = cleaned === 'O-O' ? 'k' : 'q';
      var castle = legal.find(function (move) { return move.flag === flag; });
      if (!castle) throw new Error('Illegal castling move "' + sanText + '".');
      return decorateParsedMove(pos, castle);
    }

    var match = cleaned.match(/^([KQRBN])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([QRBN]))?$/);
    if (!match) throw new Error('Could not read move "' + sanText + '".');
    var pieceType = match[1] || 'P';
    var fromFile = match[2] || '';
    var fromRank = match[3] || '';
    var toSquare = match[4];
    var promotion = match[5] || null;
    var wantsCapture = cleaned.indexOf('x') !== -1;

    var candidates = legal.filter(function (move) {
      var piece = pos.board[move.from];
      if (!piece || piece[1] !== pieceType || move.to !== squareToIndex(toSquare)) return false;
      if (fromFile && FILES[move.from % 8] !== fromFile) return false;
      if (fromRank && String(8 - Math.floor(move.from / 8)) !== fromRank) return false;
      if (pieceType === 'P') {
        if (promotion && move.promotion !== promotion) return false;
        if (!promotion && move.promotion) return false;
      } else if (move.promotion) {
        return false;
      }
      if (wantsCapture && !move.captured) return false;
      return true;
    });

    if (candidates.length !== 1) {
      throw new Error('Illegal or ambiguous move "' + sanText + '".');
    }
    return decorateParsedMove(pos, candidates[0]);
  }

  function decorateParsedMove(pos, move) {
    var result = {
      from: move.from,
      to: move.to,
      promotion: move.promotion,
      flag: move.flag,
      captured: move.captured || null
    };
    result.uci = moveToUci(result);
    result.san = moveToSan(pos, result);
    var next = makeMove(pos, result);
    result.fenAfter = toFen(next);
    result.isCheck = isInCheck(next, next.turn);
    result.isMate = result.isCheck && generateLegalMoves(next).length === 0;
    return result;
  }

  function materialSummary(board) {
    var counts = {
      w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
      b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }
    };
    for (var i = 0; i < 64; i++) {
      var piece = board[i];
      if (piece) counts[piece[0]][piece[1].toLowerCase()]++;
    }
    var value = { w: 0, b: 0 };
    ['w', 'b'].forEach(function (color) {
      Object.keys(counts[color]).forEach(function (type) {
        value[color] += counts[color][type] * PIECE_VALUES[type];
      });
    });
    return { counts: counts, value: value };
  }

  global.ChessCore = {
    FILES: FILES,
    START_FEN: START_FEN,
    squareToIndex: squareToIndex,
    indexToSquare: indexToSquare,
    initialPosition: initialPosition,
    emptyPosition: emptyPosition,
    clonePosition: clonePosition,
    parseFen: parseFen,
    toFen: toFen,
    makeMove: makeMove,
    generateLegalMoves: generateLegalMoves,
    isInCheck: isInCheck,
    isSquareAttacked: isSquareAttacked,
    findKing: findKing,
    moveToUci: moveToUci,
    moveToSan: moveToSan,
    parseSan: parseSan,
    materialSummary: materialSummary,
    pieceValues: PIECE_VALUES
  };
})(window);

/* Gambit — application shell, reader, library and practice room. */
(function () {
  'use strict';

  var Chess = window.ChessCore;
  var PGN = window.PGN;
  var SAMPLES = window.GAMBIT_SAMPLES || [];

  var STORAGE = {
    imported: 'gambit.imported.v1',
    favorites: 'gambit.favorites.v1',
    stats: 'gambit.stats.v1',
    prefs: 'gambit.prefs.v1'
  };

  var NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  var LETTERS = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight' };

  var el = {};
  var storageWarningShown = false;
  var state = {
    games: [],
    selectedId: null,
    ply: 0,
    flipped: false,
    filter: 'all',
    search: '',
    favorites: new Set(),
    stats: defaultStats(),
    selection: null,
    selectedMoves: [],
    pendingPromotion: null,
    explore: null,
    autoTimer: null,
    tab: 'moves',
    importMode: 'paste',
    pendingFileText: '',
    pendingFileName: '',
    dragDepth: 0,
    train: {
      active: false,
      mode: 'guess',
      color: 'w',
      startChoice: 'current',
      questions: [],
      index: 0,
      correct: 0,
      attempts: 0,
      streak: 0,
      awaiting: false,
      feedback: null,
      hintFrom: null,
      config: null,
      returnPly: 0,
      summaryMode: null
    },
    coords: {
      active: false,
      running: false,
      target: 'e4',
      score: 0,
      attempts: 0,
      streak: 0,
      timer: null,
      endAt: 0,
      flash: null,
      flashTimer: null,
      returnPly: 0
    }
  };

  /* =========================================================
     Small utilities
     ========================================================= */

  function defaultStats() {
    return {
      guessAttempts: 0,
      guessCorrect: 0,
      guessBestStreak: 0,
      coordBest: 0,
      coordBestStreak: 0,
      practiceDays: []
    };
  }

  function $(id) {
    return document.getElementById(id);
  }

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function icon(name, cls) {
    return '<svg class="ico ' + (cls || '') + '" aria-hidden="true"><use href="#' + name + '"></use></svg>';
  }

  function setUseIcon(button, name) {
    if (!button) return;
    var use = button.querySelector('use');
    if (use) use.setAttribute('href', name.charAt(0) === '#' ? name : '#' + name);
  }

  function readJSON(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      if (!storageWarningShown) {
        storageWarningShown = true;
        toast('Your browser could not save this locally. The current session still works.', 'error');
      }
      return false;
    }
  }

  function pad2(number) {
    return number < 10 ? '0' + number : String(number);
  }

  function dateKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function dateFromKey(key) {
    var parts = String(key).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function newId() {
    return 'game-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function clamp(number, min, max) {
    return Math.max(min, Math.min(max, number));
  }

  /* =========================================================
     Game helpers
     ========================================================= */

  function currentGame() {
    if (!state.games.length) return null;
    for (var i = 0; i < state.games.length; i++) {
      if (state.games[i].id === state.selectedId) return state.games[i];
    }
    return state.games[0];
  }

  function gameById(id) {
    for (var i = 0; i < state.games.length; i++) {
      if (state.games[i].id === id) return state.games[i];
    }
    return null;
  }

  function prepareGame(game, id, source) {
    game.id = id;
    game.source = source;
    game._positions = null;
    game.pgn = PGN.build(game);
    return game;
  }

  function loadInitialGames() {
    var sampleGames = [];
    SAMPLES.forEach(function (sample) {
      var parsed = PGN.parse(sample.pgn);
      if (parsed.games[0]) {
        sampleGames.push(prepareGame(parsed.games[0], sample.id, 'sample'));
      } else if (window.console) {
        window.console.warn('Could not load sample:', sample.id, parsed.errors);
      }
    });

    var importedGames = [];
    var records = readJSON(STORAGE.imported, []);
    if (Array.isArray(records)) {
      records.forEach(function (record) {
        if (!record || typeof record.pgn !== 'string') return;
        var parsed = PGN.parse(record.pgn);
        if (!parsed.games[0]) return;
        var game = prepareGame(parsed.games[0], record.id || newId(), 'imported');
        game.createdAt = record.createdAt || Date.now();
        importedGames.push(game);
      });
    }

    importedGames.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    state.games = importedGames.concat(sampleGames);
  }

  function refreshPositions(game) {
    if (!game.startPosition) {
      try {
        game.startPosition = game.startFen ? Chess.parseFen(game.startFen) : Chess.initialPosition();
      } catch (error) {
        game.startPosition = Chess.initialPosition();
      }
    }
    if (!game._positions) {
      game._positions = [Chess.clonePosition(game.startPosition)];
    }
    while (game._positions.length <= game.moves.length) {
      var index = game._positions.length - 1;
      game._positions.push(Chess.makeMove(game._positions[index], game.moves[index]));
    }
    return game._positions;
  }

  function positionAt(ply) {
    var game = currentGame();
    if (!game) return Chess.initialPosition();
    var safePly = clamp(Number(ply) || 0, 0, game.moves.length);
    return refreshPositions(game)[safePly];
  }

  function displayPosition() {
    if (state.coords.active) return Chess.emptyPosition();
    if (state.explore) return state.explore.position;
    return positionAt(state.ply);
  }

  function playerName(game, color) {
    if (!game) return color === 'w' ? 'White' : 'Black';
    return game.headers[color === 'w' ? 'White' : 'Black'] || (color === 'w' ? 'White' : 'Black');
  }

  function eventName(game) {
    if (!game) return 'Untitled game';
    var event = game.headers.Event;
    if (!event || event === '?') {
      return playerName(game, 'w') + ' vs ' + playerName(game, 'b');
    }
    return event;
  }

  function gameResult(game) {
    if (!game) return '*';
    return game.result || game.headers.Result || '*';
  }

  function resultLabel(result) {
    if (result === '1-0') return '1–0';
    if (result === '0-1') return '0–1';
    if (result === '1/2-1/2') return '½–½';
    return result || '*';
  }

  function yearOf(game) {
    if (!game) return '';
    var date = String(game.headers.Date || '');
    var match = date.match(/\b(\d{4})\b/);
    return match ? match[1] : '';
  }

  function cityOf(game) {
    if (!game || !game.headers.Site) return '';
    var site = String(game.headers.Site);
    if (site === '?' || site === '-') return '';
    return site.split(',')[0].trim();
  }

  function dateLabel(game) {
    if (!game) return '—';
    var raw = String(game.headers.Date || '');
    var parts = raw.split('.');
    if (parts.length >= 3 && /^\d{4}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1]) && /^\d{1,2}$/.test(parts[2])) {
      var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
    }
    return yearOf(game) || raw || '—';
  }

  function locationLabel(game) {
    var city = cityOf(game);
    var year = yearOf(game);
    if (city && year) return city + ', ' + year;
    if (city) return city;
    if (year) return year;
    return 'Location unknown';
  }

  function openingName(game) {
    if (!game) return 'Unclassified';
    return game.headers.Opening || game.headers.ECO || 'Unclassified';
  }

  function shortOpening(game) {
    var opening = openingName(game);
    return opening.split(':')[0];
  }

  function moveCountLabel(game) {
    if (!game) return '0 moves';
    var count = Math.ceil(game.moves.length / 2);
    return count + (count === 1 ? ' move' : ' moves');
  }

  function annotations(game) {
    if (!game) return 0;
    return game.moves.filter(function (move) {
      return !!(move.comment || (move.nags && move.nags.length));
    }).length;
  }

  function notationForMove(list, move) {
    var prefix = move.moveNumber + (move.color === 'w' ? '.' : '...');
    return prefix + ' ' + move.san;
  }

  function pieceName(piece) {
    var type = NAMES[piece[1]] || 'piece';
    return (piece[0] === 'w' ? 'White ' : 'Black ') + type;
  }

  /* =========================================================
     Persistent stats and preferences
     ========================================================= */

  function loadStats() {
    var stored = readJSON(STORAGE.stats, {});
    var stats = defaultStats();
    if (stored && typeof stored === 'object') {
      Object.keys(stats).forEach(function (key) {
        if (key === 'practiceDays') {
          if (Array.isArray(stored.practiceDays)) stats.practiceDays = stored.practiceDays.slice(-730);
        } else if (Number.isFinite(Number(stored[key]))) {
          stats[key] = Number(stored[key]);
        }
      });
    }
    return stats;
  }

  function saveStats() {
    writeJSON(STORAGE.stats, state.stats);
  }

  function practiceStreak() {
    if (!state.stats.practiceDays.length) return 0;
    var days = new Set(state.stats.practiceDays);
    var cursor = new Date();
    if (!days.has(dateKey(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
      if (!days.has(dateKey(cursor))) return 0;
    }
    var streak = 0;
    while (days.has(dateKey(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  function recordPracticeDay() {
    var key = dateKey(new Date());
    if (state.stats.practiceDays.indexOf(key) === -1) {
      state.stats.practiceDays.push(key);
      if (state.stats.practiceDays.length > 730) state.stats.practiceDays.shift();
      saveStats();
    }
    updateStreakDisplay();
  }

  function updateStreakDisplay() {
    var streak = practiceStreak();
    el.streakCount.textContent = String(streak);
    el.streakPill.classList.toggle('is-hot', streak > 0);
    el.streakPill.title = streak
      ? streak + ' day practice streak'
      : 'Complete a practice session to start a streak';
  }

  function updateStatsDisplay() {
    var attempts = Number(state.stats.guessAttempts) || 0;
    var correct = Number(state.stats.guessCorrect) || 0;
    el.statAttempts.textContent = String(attempts);
    el.statAccuracy.textContent = attempts ? Math.round((correct / attempts) * 100) + '%' : '—';
    el.statBestStreak.textContent = String(state.stats.guessBestStreak || 0);
    el.coordBest.textContent = String(state.stats.coordBest || 0);
    el.coordStreak.textContent = String(state.stats.coordBestStreak || 0);
    updateStreakDisplay();
  }

  function loadPrefs() {
    var prefs = readJSON(STORAGE.prefs, {});
    if (!prefs || typeof prefs !== 'object') prefs = {};
    return prefs;
  }

  function savePrefs() {
    writeJSON(STORAGE.prefs, {
      lastGameId: state.selectedId,
      lastPly: state.ply,
      flipped: !!state.flipped
    });
  }

  function persistImported() {
    var records = state.games.filter(function (game) {
      return game.source === 'imported';
    }).map(function (game) {
      return {
        id: game.id,
        pgn: game.pgn || PGN.build(game),
        createdAt: game.createdAt || Date.now()
      };
    });
    writeJSON(STORAGE.imported, records);
  }

  /* =========================================================
     Piece artwork
     ========================================================= */

  var PIECE_ART = {
    P: '<circle cx="22.5" cy="13.2" r="5.1"/>' +
       '<path d="M18.4 19.2h8.2l1.2 5.4c.6 2.8-1.4 4.8-3.7 4.8h-3.2c-2.3 0-4.3-2-3.7-4.8l1.2-5.4Z"/>' +
       '<path d="M16 30.5h13c1.6 0 2.6 1.1 2.8 2.6l.3 2.9H12.9l.3-2.9c.2-1.5 1.2-2.6 2.8-2.6Z"/>' +
       '<path class="piece-detail" d="M18.6 21.4c2.4 1.3 5.4 1.3 7.8 0"/>',
    R: '<path d="M13 8.8h5v3.2h4V8.8h5v3.2h4V8.8h5v8.8H13V8.8Z"/>' +
       '<path d="M16.2 17.6h15.6l-1.5 13.2H17.7L16.2 17.6Z"/>' +
       '<path d="M14.2 30.8h19.6l1 3.2H13.2l1-3.2Z"/>' +
       '<path d="M11.8 34h21.4v3.6H11.8Z"/>' +
       '<path class="piece-detail" d="M18.1 27.2h12.8M18 20.4h13"/>',
    B: '<circle cx="22.5" cy="7.2" r="2"/>' +
       '<path d="M22.5 10.2c1 1.6.4 2.9-.6 3.8 4.5 3.8 7.4 7.4 7.4 11 0 3.9-3.4 6.5-6.8 6.5s-6.8-2.6-6.8-6.5c0-3.6 2.9-7.2 7.4-11-1-1-1.5-2.2-.6-3.8Z"/>' +
       '<path d="M15.8 28.7h13.4l.9 3.1H14.9l.9-3.1Z"/>' +
       '<path d="M12.4 31.8h20.2V36H12.4Z"/>' +
       '<path class="piece-detail" d="M18.9 18.3l7.1 7.1M22.5 10.3v3.4"/>',
    N: '<path d="M14.8 31C15.4 27.8 16 24.6 17.5 22.2l-4.3 1.2c.6-3.6 3-7 6.4-9L22.2 8.2l3.2 3.4c3-.1 4.8 1.9 4.6 4.4-.2 2.4-2.2 4.2-5 4.4 2.1 2.6 3.9 5.6 3.9 10.4H14.8Z"/>' +
       '<path d="M14 31h17c1.3 0 2.2 1 2.2 2.2V35H11.8v-1.8c0-1.2.9-2.2 2.2-2.2Z"/>' +
       '<path d="M10.5 35h24v3.5h-24Z"/>' +
       '<path class="piece-detail" d="M26.8 13c1.5 2 1.8 4.4 1 6.5M23.3 15.6h.1M18.4 23.4c2.2-.7 4.1-2.2 5.4-4.1"/>' +
       '<circle class="piece-detail" cx="23.4" cy="15.7" r="0.8"/>',
    Q: '<circle cx="10.4" cy="9.1" r="1.8"/>' +
       '<circle cx="17" cy="6.2" r="1.8"/>' +
       '<circle cx="28" cy="6.2" r="1.8"/>' +
       '<circle cx="34.6" cy="9.1" r="1.8"/>' +
       '<path d="M12 17.4 13.3 9l5 4.9 4.2-6.7 4.2 6.7 5-4.9L33 17.4l-2.6 10.9H14.6L12 17.4Z"/>' +
       '<path d="M16 28.3h13l.9 4.2H15.1l.9-4.2Z"/>' +
       '<path d="M12.2 32.5h20.6V36H12.2Z"/>' +
       '<path class="piece-detail" d="M17.8 17.5h9.4M18.3 25.8h8.4"/>',
    K: '<path d="M21.2 4.4h2.6v3.2h3.2V10h-3.2v3.2h-2.6V10h-3.2V7.6h3.2V4.4Z"/>' +
       '<path d="M22.5 14.5c-3.8.8-6.2 3.4-6.8 6.9l-1.1 7h15.8l-1.1-7c-.6-3.5-3-6.1-6.8-6.9Z"/>' +
       '<path d="M14.6 28.4h15.8l.8 3.5H13.8l.8-3.5Z"/>' +
       '<path d="M11.8 31.9h21.4v4.1H11.8Z"/>' +
       '<path class="piece-detail" d="M18.4 17.6c2.6 1.1 5.6 1.1 8.2 0M18.5 26.4h8"/>'
  };

  function pieceSvg(piece) {
    var color = piece[0];
    return '<svg class="piece-svg ' + color + '" viewBox="0 0 45 45" aria-hidden="true"><g class="piece-body">' +
      PIECE_ART[piece[1]] + '</g></svg>';
  }

  /* =========================================================
     Library rendering
     ========================================================= */

  function filteredGames() {
    var query = state.search.trim().toLowerCase();
    return state.games.filter(function (game) {
      if (state.filter === 'starred' && !state.favorites.has(game.id)) return false;
      if (state.filter === 'imported' && game.source !== 'imported') return false;
      if (!query) return true;
      var haystack = [
        game.headers.Event, game.headers.White, game.headers.Black,
        game.headers.Site, game.headers.Opening, game.headers.ECO,
        game.headers.Annotator, game.headers.Date
      ].join(' ').toLowerCase();
      return haystack.indexOf(query) !== -1;
    });
  }

  function renderLibrary() {
    var visible = filteredGames();
    el.gameList.innerHTML = '';
    el.gameCount.textContent = String(visible.length);

    if (!visible.length) {
      var empty = make('div', 'library-empty');
      var title = make('strong', null, state.games.length ? 'No games found.' : 'Your library is empty.');
      empty.appendChild(title);
      empty.appendChild(document.createTextNode(
        state.games.length ? 'Try another name, event or opening.' : 'Import a PGN to start reading.'
      ));
      el.gameList.appendChild(empty);
    } else {
      visible.forEach(function (game) {
        el.gameList.appendChild(gameCard(game));
      });
    }

    el.libraryMeta.textContent = state.games.length + (state.games.length === 1 ? ' game' : ' games');
    updateStarButtons();
  }

  function gameCard(game) {
    var active = game.id === state.selectedId;
    var card = make('div', 'game-item' + (active ? ' is-active' : ''));
    card.dataset.id = game.id;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-current', active ? 'true' : 'false');

    var head = make('div', 'game-item-head');
    head.appendChild(make('span', 'game-event', eventName(game)));
    head.appendChild(make('span', 'game-result', resultLabel(gameResult(game))));
    card.appendChild(head);

    var players = make('p', 'game-players');
    ['w', 'b'].forEach(function (color) {
      var line = make('span', 'game-player');
      line.appendChild(make('i', 'player-pip ' + color));
      line.appendChild(document.createTextNode(playerName(game, color)));
      players.appendChild(line);
    });
    card.appendChild(players);

    var foot = make('div', 'game-item-foot');
    foot.appendChild(make('span', null, yearOf(game) || 'Undated'));
    foot.appendChild(make('span', 'dot', '·'));
    foot.appendChild(make('span', null, moveCountLabel(game)));

    var star = make('button', 'game-star' + (state.favorites.has(game.id) ? ' is-starred' : ''));
    star.type = 'button';
    star.dataset.star = game.id;
    star.setAttribute('aria-label', state.favorites.has(game.id) ? 'Unstar game' : 'Star game');
    star.setAttribute('title', state.favorites.has(game.id) ? 'Unstar game' : 'Star game');
    star.innerHTML = icon('i-star');
    star.addEventListener('click', function (event) {
      event.stopPropagation();
      toggleFavorite(game.id);
    });
    foot.appendChild(star);
    card.appendChild(foot);

    card.addEventListener('click', function (event) {
      if (event.target.closest('.game-star')) return;
      selectGame(game.id);
    });
    card.addEventListener('keydown', function (event) {
      if (event.target !== card) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectGame(game.id);
      }
    });

    return card;
  }

  function toggleFavorite(id) {
    if (state.favorites.has(id)) state.favorites.delete(id);
    else state.favorites.add(id);
    writeJSON(STORAGE.favorites, Array.from(state.favorites));
    renderLibrary();
    updateStarButtons();
  }

  function updateStarButtons() {
    var game = currentGame();
    var starred = !!(game && state.favorites.has(game.id));
    [el.starBtn, el.detailStarBtn].forEach(function (button) {
      if (!button) return;
      button.classList.toggle('is-starred', starred);
      button.setAttribute('aria-pressed', starred ? 'true' : 'false');
      button.setAttribute('aria-label', starred ? 'Unstar this game' : 'Star this game');
      button.setAttribute('title', starred ? 'Unstar this game' : 'Star this game');
    });
  }

  /* =========================================================
     Reader rendering
     ========================================================= */

  function renderReaderHeader() {
    var game = currentGame();
    if (!game) return;
    el.contextEvent.textContent = eventName(game);
    el.contextRound.textContent = locationLabel(game);
    el.contextPlayers.innerHTML = '';
    el.contextPlayers.appendChild(document.createTextNode(playerName(game, 'w')));
    el.contextPlayers.appendChild(make('em', null, 'vs'));
    el.contextPlayers.appendChild(document.createTextNode(playerName(game, 'b')));
    el.contextPlayers.title = playerName(game, 'w') + ' vs ' + playerName(game, 'b');
  }

  function renderPlayerRow(container, color) {
    var game = currentGame();
    if (!game) return;
    var nameNode = color === 'w' ? el.bottomName : el.topName;
    var titleNode = color === 'w' ? el.bottomTitle : el.topTitle;
    var capturesNode = color === 'w' ? el.bottomCaptures : el.topCaptures;
    var materialNode = color === 'w' ? el.bottomMaterial : el.topMaterial;
    var rowNode = color === 'w' ? el.playerBottom : el.playerTop;

    nameNode.textContent = playerName(game, color);
    var title = game.headers[color === 'w' ? 'WhiteTitle' : 'BlackTitle'] || '';
    var elo = game.headers[color === 'w' ? 'WhiteElo' : 'BlackElo'] || '';
    titleNode.textContent = title || (elo ? elo : '');

    var position = displayPosition();
    var isTurn = !state.coords.active && position.turn === color;
    rowNode.classList.toggle('is-turn', isTurn);

    capturesNode.innerHTML = '';
    materialNode.textContent = '';

    if (state.coords.active) return;

    var startMaterial = Chess.materialSummary(game.startPosition ? game.startPosition.board : Chess.initialPosition().board);
    var base = startMaterial.counts;
    var nowMaterial = Chess.materialSummary(position.board);
    var now = nowMaterial.counts;
    var opponent = color === 'w' ? 'b' : 'w';
    var order = ['q', 'r', 'b', 'n', 'p'];

    order.forEach(function (type) {
      var missing = Math.max(0, (base[opponent][type] || 0) - (now[opponent][type] || 0));
      for (var i = 0; i < missing; i++) {
        var piece = make('span', 'captured-piece');
        piece.title = (opponent === 'w' ? 'White ' : 'Black ') + NAMES[type];
        piece.innerHTML = pieceSvg(opponent + type.toUpperCase());
        capturesNode.appendChild(piece);
      }
    });

    var advantage = (nowMaterial.value.w - nowMaterial.value.b) -
      (startMaterial.value.w - startMaterial.value.b);
    if (advantage > 0) materialNode.textContent = '+' + advantage;
  }

  function renderPlayers() {
    var game = currentGame();
    if (!game) return;
    var topColor = state.flipped ? 'w' : 'b';
    var bottomColor = state.flipped ? 'b' : 'w';
    el.playerTop.dataset.color = topColor;
    el.playerBottom.dataset.color = bottomColor;
    renderPlayerRow(el.playerTop, topColor);
    renderPlayerRow(el.playerBottom, bottomColor);
  }

  function renderBoard() {
    var game = currentGame();
    if (!game) return;
    var position = displayPosition();
    var lastMove = null;
    if (state.explore && state.explore.moves.length) {
      lastMove = state.explore.moves[state.explore.moves.length - 1];
    } else if (state.ply > 0) {
      lastMove = game.moves[state.ply - 1];
    }

    var checkSquare = -1;
    if (!state.coords.active && Chess.isInCheck(position, position.turn)) {
      checkSquare = Chess.findKing(position.board, position.turn);
    }

    var selection = state.selection;
    var selectedMoves = state.selectedMoves || [];
    var promoOpen = !!state.pendingPromotion;
    var feedback = state.train.active ? state.train.feedback : null;
    var coordsFlash = state.coords.flash;
    var locked = (state.train.active && !state.train.awaiting) || promoOpen;

    var fragment = document.createDocumentFragment();
    for (var displayRow = 0; displayRow < 8; displayRow++) {
      for (var displayCol = 0; displayCol < 8; displayCol++) {
        var rank = state.flipped ? displayRow + 1 : 8 - displayRow;
        var file = state.flipped ? 7 - displayCol : displayCol;
        var index = (8 - rank) * 8 + file;
        var square = Chess.indexToSquare(index);
        var piece = state.coords.active ? null : position.board[index];
        var cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'sq ' + ((displayRow + displayCol) % 2 === 0 ? 'light' : 'dark');
        cell.dataset.square = square;
        cell.dataset.index = String(index);
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-label', square + (piece ? ', ' + pieceName(piece) : ', empty'));

        if (piece) {
          var pieceNode = document.createElement('span');
          pieceNode.className = 'piece';
          pieceNode.innerHTML = pieceSvg(piece);
          cell.appendChild(pieceNode);
        }

        if (lastMove && (lastMove.from === index || lastMove.to === index)) {
          cell.classList.add('is-last');
        }
        if (selection === index) cell.classList.add('is-selected');
        if (checkSquare === index) cell.classList.add('is-check');

        if (selection !== null) {
          for (var m = 0; m < selectedMoves.length; m++) {
            if (selectedMoves[m].to === index) {
              var marker = document.createElement('span');
              marker.className = piece ? 'legal-ring' : 'legal-dot';
              cell.appendChild(marker);
              break;
            }
          }
        }

        if (state.train.active && state.train.hintFrom === index) {
          cell.classList.add('is-hint');
        }
        if (feedback) {
          if (feedback.type === 'correct' && feedback.to === index) {
            cell.classList.add('is-correct');
          }
          if (feedback.type === 'wrong' && feedback.to === index) {
            cell.classList.add('is-correct');
          }
          if ((feedback.type === 'wrong' || feedback.type === 'skip') &&
              (feedback.wrongFrom === index || feedback.wrongTo === index)) {
            cell.classList.add('is-wrong');
          }
          if (feedback.type === 'skip' && feedback.to === index) {
            cell.classList.add('is-correct');
          }
        }
        if (coordsFlash) {
          if (coordsFlash.correct === index) cell.classList.add('is-correct');
          if (coordsFlash.wrong === index) cell.classList.add('is-wrong');
          if (coordsFlash.target === index) cell.classList.add('is-hint');
        }

        if (displayRow === 7) {
          var fileLabel = make('span', 'coord coord-file', square[0]);
          cell.appendChild(fileLabel);
        }
        if (displayCol === 0) {
          var rankLabel = make('span', 'coord coord-rank', square[1]);
          cell.appendChild(rankLabel);
        }

        fragment.appendChild(cell);
      }
    }
    el.board.innerHTML = '';
    el.board.appendChild(fragment);
    el.board.classList.toggle('is-locked', locked);
    el.board.setAttribute('aria-label', 'Chess board, ' + (state.coords.active
      ? 'coordinates drill'
      : playerName(game, 'w') + ' versus ' + playerName(game, 'b')));

    var total = Math.max(1, game.moves.length);
    var progress = state.explore ? (state.explore.basePly / total) : (state.ply / total);
    var evalFill = document.querySelector('.eval-bar-fill');
    if (evalFill) evalFill.style.height = Math.round(clamp(progress, 0, 1) * 100) + '%';
  }

  function renderTransport() {
    var game = currentGame();
    if (!game) return;
    var locked = state.train.active || state.coords.active;
    var buttons = [el.firstBtn, el.prevBtn, el.playBtn, el.nextBtn, el.lastBtn];
    buttons.forEach(function (button) { button.disabled = locked; });
    el.firstBtn.disabled = locked || (state.ply === 0 && !state.explore);
    el.prevBtn.disabled = locked || (state.ply === 0 && !state.explore);
    el.nextBtn.disabled = locked || (!state.explore && state.ply >= game.moves.length);
    el.lastBtn.disabled = locked || (!state.explore && state.ply >= game.moves.length);
    el.timeline.disabled = locked;
    el.timeline.max = String(Math.max(1, game.moves.length));
    el.timeline.value = String(state.ply);
    var percent = game.moves.length ? (state.ply / game.moves.length) * 100 : 0;
    el.timeline.style.setProperty('--progress', percent + '%');

    setUseIcon(el.playBtn, state.autoTimer ? 'i-pause' : 'i-play');
    el.playBtn.setAttribute('aria-label', state.autoTimer ? 'Pause' : 'Play through game');
    el.playBtn.title = state.autoTimer ? 'Pause (Space)' : 'Play through game (Space)';

    el.exploreBar.hidden = !state.explore;
    if (state.explore) {
      el.timelineMove.textContent = 'Sideline from move ' + Math.ceil(state.explore.basePly / 2);
      el.timelineTurn.textContent = 'Not in score';
      return;
    }

    if (state.coords.active) {
      el.timelineMove.textContent = 'Coordinates drill';
      el.timelineTurn.textContent = state.coords.running ? 'Find the square' : 'Drill complete';
      return;
    }

    var position = displayPosition();
    var turnName = position.turn === 'w' ? 'White' : 'Black';
    if (state.ply === 0) {
      el.timelineMove.textContent = 'Starting position';
    } else if (state.ply >= game.moves.length) {
      el.timelineMove.textContent = 'Final position';
    } else {
      el.timelineMove.textContent = 'Move ' + position.fullmove;
    }

    if (state.ply >= game.moves.length) {
      el.timelineTurn.textContent = gameResult(game) === '*'
        ? 'Game score'
        : resultLabel(gameResult(game));
    } else if (Chess.isInCheck(position, position.turn)) {
      el.timelineTurn.textContent = turnName + ' to move · check';
    } else {
      el.timelineTurn.textContent = turnName + ' to move';
    }
  }

  function renderMoveLog() {
    var game = currentGame();
    if (!game) return;
    el.moveLog.innerHTML = '';
    if (!game.moves.length) {
      el.moveLog.appendChild(make('div', 'moment-empty', 'No moves in this score.'));
      return;
    }

    var rows = [];
    var byNumber = {};
    game.moves.forEach(function (move) {
      var key = String(move.moveNumber);
      if (!byNumber[key]) {
        byNumber[key] = { number: move.moveNumber, white: null, black: null };
        rows.push(byNumber[key]);
      }
      byNumber[key][move.color === 'w' ? 'white' : 'black'] = move;
    });

    var activeButton = null;

    rows.forEach(function (row) {
      var rowNode = make('div', 'move-row');
      rowNode.appendChild(make('span', 'move-num', row.number + '.'));
      ['white', 'black'].forEach(function (side) {
        var move = row[side];
        if (!move) {
          rowNode.appendChild(make('span', 'move-btn', ''));
          return;
        }
        var button = make('button', 'move-btn' + (state.ply === move.ply && !state.explore ? ' is-active' : ''));
        button.type = 'button';
        button.dataset.ply = String(move.ply);
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', state.ply === move.ply && !state.explore ? 'true' : 'false');
        button.title = notationForMove(game.moves, move);
        button.appendChild(document.createTextNode(move.san));
        if (move.nags && move.nags.length) {
          button.appendChild(make('span', 'move-nag', PGN.nagText(move.nags[0]) || ('$' + move.nags[0])));
        }
        if (move.comment) button.appendChild(make('span', 'note-mark'));
        button.addEventListener('click', function () {
          if (state.train.active) {
            toast('Finish or end the practice session before browsing the score.', 'error');
            return;
          }
          stopAutoplay();
          state.explore = null;
          state.ply = move.ply;
          state.selection = null;
          state.selectedMoves = [];
          savePrefs();
          renderMain();
        });
        if (state.ply === move.ply && !state.explore) activeButton = button;
        rowNode.appendChild(button);
      });
      el.moveLog.appendChild(rowNode);
    });

    if (activeButton) {
      window.requestAnimationFrame(function () {
        var logRect = el.moveLog.getBoundingClientRect();
        var activeRect = activeButton.getBoundingClientRect();
        if (activeRect.top < logRect.top || activeRect.bottom > logRect.bottom) {
          activeButton.scrollIntoView({ block: 'nearest' });
        }
      });
    }
  }

  function renderNote() {
    var game = currentGame();
    if (!game) return;
    el.noteMove.textContent = '';
    el.noteText.classList.remove('is-empty');
    if (state.explore) {
      el.noteLabel.textContent = 'Sideline';
      el.noteText.textContent = 'You are exploring a move outside the score. Return to the game to continue reading its annotations.';
      el.noteText.classList.add('is-empty');
      return;
    }
    if (state.ply === 0) {
      el.noteLabel.textContent = 'Study note';
      el.noteMove.textContent = '';
      el.noteText.textContent = 'The starting position. Use the arrow keys or click any move to begin reading.';
      el.noteText.classList.add('is-empty');
      return;
    }
    var move = game.moves[state.ply - 1];
    if (!move) return;
    el.noteMove.textContent = move.moveNumber + (move.color === 'w' ? '.' : '...') + ' ' + move.san;
    el.noteLabel.textContent = 'Study note';
    if (move.comment) {
      el.noteText.textContent = move.comment;
    } else if (move.nags && move.nags.length) {
      el.noteText.textContent = 'Marked ' + (PGN.nagText(move.nags[0]) || ('$' + move.nags[0])) + '.';
      el.noteText.classList.add('is-empty');
    } else {
      el.noteText.textContent = 'No annotation on this move. The board remembers what the score sheet does not.';
      el.noteText.classList.add('is-empty');
    }
  }

  function gameMoments(game) {
    if (!game) return [];
    var moments = [];
    var firstCapture = null;
    var firstCheck = null;
    var firstAnnotation = null;
    var castles = 0;
    var mate = null;
    var promotion = null;
    var queenCapture = null;

    game.moves.forEach(function (move) {
      if (move.captured && !firstCapture) firstCapture = move;
      if (move.isCheck && !firstCheck) firstCheck = move;
      if (move.comment && !firstAnnotation) firstAnnotation = move;
      if (move.flag === 'k' || move.flag === 'q') castles++;
      if (move.promotion && !promotion) promotion = move;
      if (move.captured && move.captured.toUpperCase() === 'Q' && !queenCapture) queenCapture = move;
      if (move.isMate) mate = move;
    });

    if (mate) moments.push({ kind: 'Mate', move: mate });
    if (promotion) moments.push({ kind: 'Promotion', move: promotion });
    if (queenCapture) moments.push({ kind: 'Queen', move: queenCapture });
    if (castles) {
      var castleMove = game.moves.filter(function (m) { return m.flag === 'k' || m.flag === 'q'; })[0];
      moments.push({ kind: 'Castles', move: castleMove, extra: castles });
    }
    if (firstCheck) moments.push({ kind: 'First check', move: firstCheck });
    if (firstCapture) moments.push({ kind: 'First capture', move: firstCapture });
    if (firstAnnotation) moments.push({ kind: 'Note', move: firstAnnotation });

    moments.sort(function (a, b) { return a.move.ply - b.move.ply; });
    return moments.slice(0, 6);
  }

  function renderMoments() {
    var game = currentGame();
    if (!game) return;
    var moments = gameMoments(game);
    el.momentCount.textContent = moments.length + (moments.length === 1 ? ' key moment' : ' key moments');
    el.momentList.innerHTML = '';
    if (!moments.length) {
      el.momentList.appendChild(make('p', 'moment-empty', 'No captures, checks or annotations found in this score.'));
      return;
    }
    moments.forEach(function (moment) {
      var button = make('button', 'moment-chip');
      button.type = 'button';
      button.dataset.ply = String(moment.move.ply);
      button.appendChild(make('span', 'moment-kind', moment.kind));
      button.appendChild(make('b', null, moment.move.moveNumber + (moment.move.color === 'w' ? '.' : '...') + moment.move.san));
      button.addEventListener('click', function () {
        if (state.train.active) {
          toast('Finish or end the practice session before browsing the score.', 'error');
          return;
        }
        stopAutoplay();
        state.explore = null;
        state.ply = moment.move.ply;
        state.selection = null;
        state.selectedMoves = [];
        savePrefs();
        renderMain();
      });
      el.momentList.appendChild(button);
    });
  }

  function renderDetails() {
    var game = currentGame();
    if (!game) return;
    el.detailTitle.textContent = eventName(game);
    el.detailWhite.textContent = playerName(game, 'w');
    el.detailBlack.textContent = playerName(game, 'b');
    el.detailResult.textContent = resultLabel(gameResult(game));
    el.metaEvent.textContent = game.headers.Event || '—';
    el.metaSite.textContent = game.headers.Site || '—';
    el.metaDate.textContent = dateLabel(game);
    el.metaRound.textContent = game.headers.Round && game.headers.Round !== '?' ? game.headers.Round : '—';
    el.metaOpening.textContent = game.headers.Opening || game.headers.ECO || '—';
    el.metaMoves.textContent = game.moves.length + ' plies';

    var checks = game.moves.filter(function (move) { return move.isCheck; }).length;
    var captures = game.moves.filter(function (move) { return !!move.captured; }).length;
    var castles = game.moves.filter(function (move) { return move.flag === 'k' || move.flag === 'q'; }).length;
    var notes = annotations(game);
    var firstCapture = game.moves.filter(function (move) { return !!move.captured; })[0];
    var insights = [
      ['Moves', Math.ceil(game.moves.length / 2) + ' (' + game.moves.length + ' plies)'],
      ['Captures', String(captures)],
      ['Checks', String(checks)],
      ['Castles', castles ? String(castles) : 'None'],
      ['Annotations', String(notes)],
      ['First capture', firstCapture ? notationForMove(game.moves, firstCapture) : 'None']
    ];
    el.insightGrid.innerHTML = '';
    insights.forEach(function (pair) {
      var card = make('div', 'insight-card');
      card.appendChild(make('span', null, pair[0]));
      card.appendChild(make('b', null, pair[1]));
      el.insightGrid.appendChild(card);
    });
    el.detailNoteCount.textContent = notes + (notes === 1 ? ' note' : ' notes');
    el.pgnRaw.value = game.pgn || PGN.build(game);
    el.deleteGameBtn.hidden = game.source !== 'imported';
    el.deleteGameBtn.textContent = '';
    el.deleteGameBtn.appendChild(make('span', null, ''));
    el.deleteGameBtn.innerHTML = icon('i-trash') + ' Remove from library';
    el.deleteGameBtn.dataset.confirm = '';
    updateStarButtons();
  }

  function renderMain() {
    var game = currentGame();
    if (!game) return;
    renderReaderHeader();
    renderBoard();
    renderPlayers();
    renderTransport();
    renderMoveLog();
    renderNote();
    renderMoments();
    renderDetails();
    updateStarButtons();
    if (!state.train.active && !state.coords.active && state.train.summaryMode === null) {
      updateTrainSetup();
    }
  }

  function renderAll() {
    renderLibrary();
    renderMain();
    updateTrainSetup();
    updateStatsDisplay();
    updateTrainingDot();
  }

  /* =========================================================
     Navigation and exploration
     ========================================================= */

  function stopAutoplay() {
    if (state.autoTimer) {
      window.clearInterval(state.autoTimer);
      state.autoTimer = null;
    }
    if (el.playBtn) {
      setUseIcon(el.playBtn, 'i-play');
      el.playBtn.setAttribute('aria-label', 'Play through game');
      el.playBtn.title = 'Play through game (Space)';
    }
  }

  function toggleAutoplay() {
    if (state.train.active || state.coords.active) return;
    if (state.autoTimer) {
      stopAutoplay();
      renderTransport();
      return;
    }
    var game = currentGame();
    if (!game || !game.moves.length) return;
    if (state.ply >= game.moves.length) {
      state.ply = 0;
      state.explore = null;
    }
    var tick = function () {
      var current = currentGame();
      if (!current || state.ply >= current.moves.length) {
        stopAutoplay();
        renderTransport();
        renderMain();
        return;
      }
      state.ply++;
      state.selection = null;
      state.selectedMoves = [];
      savePrefs();
      renderMain();
    };
    state.autoTimer = window.setInterval(tick, 950);
    setUseIcon(el.playBtn, 'i-pause');
    el.playBtn.setAttribute('aria-label', 'Pause');
    el.playBtn.title = 'Pause (Space)';
  }

  function navigate(delta) {
    if (state.train.active || state.coords.active) return;
    stopAutoplay();
    if (state.explore) {
      if (delta < 0) {
        if (state.explore.moves.length > 1) {
          state.explore.history.pop();
          state.explore.moves.pop();
          state.explore.position = state.explore.history[state.explore.history.length - 1];
          state.selection = null;
          state.selectedMoves = [];
          renderMain();
          return;
        }
        exitExplore();
        return;
      }
      exitExplore(false);
    }
    var game = currentGame();
    if (!game) return;
    state.ply = clamp(state.ply + delta, 0, game.moves.length);
    state.selection = null;
    state.selectedMoves = [];
    savePrefs();
    renderMain();
  }

  function goToPly(ply) {
    if (state.train.active || state.coords.active) return;
    stopAutoplay();
    var game = currentGame();
    if (!game) return;
    state.explore = null;
    state.ply = clamp(ply, 0, game.moves.length);
    state.selection = null;
    state.selectedMoves = [];
    savePrefs();
    renderMain();
  }

  function exitExplore(shouldRender) {
    if (!state.explore) return;
    state.ply = clamp(state.explore.basePly, 0, currentGame() ? currentGame().moves.length : 0);
    state.explore = null;
    state.selection = null;
    state.selectedMoves = [];
    if (shouldRender !== false) renderMain();
  }

  function selectGame(id, options) {
    options = options || {};
    if (!gameById(id)) return;
    var changed = id !== state.selectedId;
    if (changed) {
      stopAutoplay();
      resetPracticeForGameChange();
      state.explore = null;
      state.selection = null;
      state.selectedMoves = [];
      state.pendingPromotion = null;
      el.promotionMenu.hidden = true;
      state.selectedId = id;
      state.ply = 0;
      savePrefs();
      renderAll();
    }
    if (state.tab !== 'moves') setTab('moves');
    closeMobileLibrary();
    if (changed && !options.silent) {
      window.requestAnimationFrame(function () {
        var active = el.gameList.querySelector('.game-item.is-active');
        if (active) active.scrollIntoView({ block: 'nearest' });
      });
    }
  }

  function resetPracticeForGameChange() {
    clearPracticeTimers();
    state.train.active = false;
    state.train.awaiting = false;
    state.train.feedback = null;
    state.train.hintFrom = null;
    state.train.questions = [];
    state.train.config = null;
    state.train.summaryMode = null;
    state.coords.active = false;
    state.coords.running = false;
    state.coords.flash = null;
    document.body.classList.remove('is-training');
    el.trainSession.hidden = true;
    el.coordSession.hidden = true;
    el.trainSummary.hidden = true;
    el.trainIdle.hidden = false;
    setReaderLocked(false);
  }

  function setReaderLocked(locked) {
    [el.firstBtn, el.prevBtn, el.playBtn, el.nextBtn, el.lastBtn].forEach(function (button) {
      button.disabled = locked;
    });
    el.timeline.disabled = locked;
  }

  /* =========================================================
     Board interaction
     ========================================================= */

  function onBoardClick(event) {
    var cell = event.target.closest('.sq');
    if (!cell) return;
    var index = Number(cell.dataset.index);
    if (state.pendingPromotion) return;
    if (state.coords.active) {
      handleCoordinateClick(index);
      return;
    }
    if (state.train.active) {
      if (!state.train.awaiting) return;
      handleSquareSelection(index, 'train');
      return;
    }
    handleSquareSelection(index, 'reader');
  }

  function handleSquareSelection(index, context) {
    var position = context === 'train' ? positionAt(state.ply) : displayPosition();
    var piece = position.board[index];
    var moves = state.selectedMoves || [];

    if (state.selection !== null) {
      var chosen = moves.filter(function (move) { return move.to === index; });
      if (chosen.length) {
        if (chosen[0].promotion) {
          openPromotion(chosen, context);
        } else {
          playBoardMove(chosen[0], context);
        }
        return;
      }
    }

    if (piece && piece[0] === position.turn) {
      if (state.selection === index) {
        state.selection = null;
        state.selectedMoves = [];
      } else {
        state.selection = index;
        state.selectedMoves = Chess.generateLegalMoves(position).filter(function (move) {
          return move.from === index;
        });
      }
      renderBoard();
      return;
    }

    if (state.selection !== null) {
      var wasSelection = state.selection;
      state.selection = null;
      state.selectedMoves = [];
      renderBoard();
      if (context === 'train') {
        shakeBoard();
        if (wasSelection !== null) {
          updateSessionPanel();
          setCoach('wrong', 'That move is not available', 'Choose one of the marked squares, or select another piece.');
        }
      }
    }
  }

  function openPromotion(candidates, context) {
    var color = positionAt(state.ply).turn;
    if (context === 'reader' && state.explore) color = state.explore.position.turn;
    el.promotionMenu.innerHTML = '';
    var card = make('div', 'promotion-card');
    card.appendChild(make('p', null, 'Promote to'));
    var choices = make('div', 'promotion-choices');
    ['Q', 'R', 'B', 'N'].forEach(function (type) {
      var candidate = candidates.find(function (move) { return move.promotion === type; });
      if (!candidate) return;
      var button = make('button', 'promotion-choice');
      button.type = 'button';
      button.setAttribute('aria-label', 'Promote to ' + LETTERS[type]);
      button.innerHTML = pieceSvg(color + type);
      button.addEventListener('click', function (event) {
        event.stopPropagation();
        el.promotionMenu.hidden = true;
        state.pendingPromotion = null;
        playBoardMove(candidate, context);
      });
      choices.appendChild(button);
    });
    card.appendChild(choices);
    var cancel = make('button', 'text-btn', 'Cancel');
    cancel.type = 'button';
    cancel.style.marginTop = '8px';
    cancel.addEventListener('click', function () {
      el.promotionMenu.hidden = true;
      state.pendingPromotion = null;
      state.selection = null;
      state.selectedMoves = [];
      renderBoard();
    });
    card.appendChild(cancel);
    el.promotionMenu.appendChild(card);
    state.pendingPromotion = { candidates: candidates, context: context };
    el.promotionMenu.hidden = false;
  }

  function playBoardMove(move, context) {
    var before = context === 'train' ? positionAt(state.ply) : displayPosition();
    var legalMoves = Chess.generateLegalMoves(before);
    var userSan = Chess.moveToSan(before, move, legalMoves);
    var normalizedMove = {
      from: move.from,
      to: move.to,
      promotion: move.promotion || null,
      flag: move.flag,
      captured: move.captured || null,
      uci: Chess.moveToUci(move)
    };
    move = normalizedMove;
    var after = Chess.makeMove(before, move);
    state.pendingPromotion = null;
    el.promotionMenu.hidden = true;
    state.selection = null;
    state.selectedMoves = [];

    if (context === 'train') {
      resolveGuessAttempt(move, userSan, after);
      return;
    }

    var game = currentGame();
    if (!game) return;
    var expected = !state.explore && state.ply < game.moves.length ? game.moves[state.ply] : null;
    if (expected && expected.uci === move.uci) {
      state.ply++;
      savePrefs();
      renderMain();
      return;
    }

    var basePly = state.explore ? state.explore.basePly : state.ply;
    var history = state.explore ? state.explore.history.slice() : [Chess.clonePosition(before)];
    var moves = state.explore ? state.explore.moves.slice() : [];
    history.push(after);
    moves.push({ from: move.from, to: move.to, promotion: move.promotion, uci: move.uci, san: userSan });
    state.explore = { basePly: basePly, position: after, history: history, moves: moves };
    state.autoTimer && stopAutoplay();
    renderMain();
  }

  /* =========================================================
     Training — shared helpers
     ========================================================= */

  function isPracticeActive() {
    return state.train.active;
  }

  function updateTrainingDot() {
    var dot = document.querySelector('.tab-spark');
    if (!dot) return;
    dot.style.opacity = state.train.active || state.coords.active ? '1' : '0.35';
  }

  function shakeBoard() {
    var frame = document.querySelector('.board-frame');
    if (!frame) return;
    frame.classList.remove('is-wrong');
    void frame.offsetWidth;
    frame.classList.add('is-wrong');
    window.setTimeout(function () { frame.classList.remove('is-wrong'); }, 320);
  }

  function setCoach(kind, title, text) {
    el.coachCard.classList.remove('is-correct', 'is-wrong', 'is-hint');
    if (kind === 'correct') {
      el.coachCard.classList.add('is-correct');
      setUseIcon(el.coachIcon, 'i-check');
    } else if (kind === 'wrong') {
      el.coachCard.classList.add('is-wrong');
      setUseIcon(el.coachIcon, 'i-close');
    } else if (kind === 'hint') {
      el.coachCard.classList.add('is-hint');
      setUseIcon(el.coachIcon, 'i-spark');
    } else if (kind === 'skip') {
      el.coachCard.classList.add('is-wrong');
      setUseIcon(el.coachIcon, 'i-chevron-right');
    } else {
      setUseIcon(el.coachIcon, 'i-target');
    }
    el.coachTitle.textContent = title;
    el.coachText.textContent = text;
  }

  function questionInfo(startPly, color, limit) {
    var game = currentGame();
    if (!game) return { indices: [], available: 0 };
    var available = [];
    for (var i = clamp(startPly, 0, game.moves.length); i < game.moves.length; i++) {
      if (color === 'both' || game.moves[i].color === color) available.push(i);
    }
    return { indices: available.slice(0, limit || 10), available: available.length };
  }

  function updateTrainSetup() {
    var game = currentGame();
    if (!game) return;
    var startPly = state.train.startChoice === 'start'
      ? 0
      : (state.explore ? state.explore.basePly : state.ply);
    var info = questionInfo(startPly, state.train.color, 10);
    var count = info.indices.length;
    el.questionEstimate.textContent = count ? count + (count === 1 ? ' question' : ' questions') : 'No questions';
    if (!count) {
      el.questionEstimateNote.textContent = 'try another start';
      el.startGuessBtn.disabled = true;
      el.startGuessBtn.title = 'There are no moves of that colour left from this position.';
    } else {
      el.startGuessBtn.disabled = false;
      el.startGuessBtn.title = '';
      if (info.available > 10) el.questionEstimateNote.textContent = 'first 10 of ' + info.available;
      else el.questionEstimateNote.textContent = state.train.color === 'both' ? 'both sides' : 'one side';
    }
  }

  function setModeUI() {
    document.querySelectorAll('.mode-btn').forEach(function (button) {
      var active = button.dataset.mode === state.train.mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    el.guessSetup.hidden = state.train.mode !== 'guess';
    el.guessStats.hidden = state.train.mode !== 'guess';
    el.coordSetup.hidden = state.train.mode !== 'coords';
    updateTrainSetup();
  }

  function clearPracticeTimers() {
    if (state.coords.timer) {
      window.clearInterval(state.coords.timer);
      state.coords.timer = null;
    }
    if (state.coords.flashTimer) {
      window.clearTimeout(state.coords.flashTimer);
      state.coords.flashTimer = null;
    }
  }

  function focusPracticePage() {
    if (window.matchMedia('(max-width: 940px)').matches) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function revealSummary() {
    if (!window.matchMedia('(max-width: 940px)').matches) return;
    window.setTimeout(function () {
      el.trainSummary.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 80);
  }

  /* =========================================================
     Training — guess the move
     ========================================================= */

  function startGuessSession(config) {
    var game = currentGame();
    if (!game) return;
    var previousReturn = state.train.returnPly;
    var configGiven = !!config;
    var cfg = config || {
      startPly: state.train.startChoice === 'start' ? 0 : (state.explore ? state.explore.basePly : state.ply),
      color: state.train.color,
      gameId: game.id
    };
    cfg.gameId = game.id;

    var info = questionInfo(cfg.startPly, cfg.color, 10);
    if (!info.indices.length) {
      toast('No moves of that colour remain from this position. Try “Move one”.', 'error');
      return;
    }

    stopAutoplay();
    if (state.explore) exitExplore(false);
    clearPracticeTimers();
    state.coords.active = false;
    state.coords.running = false;
    state.train.active = true;
    state.train.mode = 'guess';
    state.train.config = cfg;
    state.train.questions = info.indices;
    state.train.index = 0;
    state.train.correct = 0;
    state.train.attempts = 0;
    state.train.streak = 0;
    state.train.awaiting = true;
    state.train.feedback = null;
    state.train.hintFrom = null;
    state.train.summaryMode = null;
    state.train.returnPly = configGiven ? previousReturn : state.ply;

    el.trainIdle.hidden = true;
    el.trainSummary.hidden = true;
    el.coordSession.hidden = true;
    el.trainSession.hidden = false;
    setTab('train');
    setReaderLocked(true);
    document.body.classList.add('is-training');
    loadGuessQuestion(0);
    updateTrainingDot();
    window.setTimeout(focusPracticePage, 30);
  }

  function loadGuessQuestion(index) {
    var game = currentGame();
    var t = state.train;
    if (!game || !t.questions.length) return;
    t.index = index;
    var moveIndex = t.questions[index];
    var move = game.moves[moveIndex];
    state.ply = moveIndex;
    state.explore = null;
    state.selection = null;
    state.selectedMoves = [];
    t.awaiting = true;
    t.feedback = null;
    t.hintFrom = null;
    setCoach('default', 'Find the game move',
      (move.color === 'w' ? 'White' : 'Black') + ' to move. Play the move from the score sheet.');
    renderMain();
    updateSessionPanel();
  }

  function updateSessionPanel() {
    var game = currentGame();
    var t = state.train;
    if (!game || !t.questions.length) return;
    var total = t.questions.length;
    var targetIndex = t.questions[t.index];
    var expected = game.moves[targetIndex];
    var questionNumber = t.index + 1;
    var accuracy = t.attempts ? Math.round((t.correct / t.attempts) * 100) : null;
    var answered = !t.awaiting;

    el.sessionEyebrow.textContent = answered ? 'Score sheet' : 'Guess the move';
    el.sessionPrompt.textContent = answered
      ? expected.san
      : (expected.color === 'w' ? 'White' : 'Black') + ' to move.';
    el.sessionProgressText.textContent = 'Question ' + questionNumber + ' of ' + total;
    el.sessionScore.textContent = (t.correct * 100) + ' pts';
    var progress = t.feedback ? (t.index + 1) / total : t.index / total;
    el.sessionProgressBar.style.width = Math.round(progress * 100) + '%';
    el.sessionStreak.textContent = String(t.streak);
    el.sessionCorrect.textContent = t.correct + ' / ' + t.attempts;
    el.sessionAccuracy.textContent = accuracy === null ? '—' : accuracy + '%';

    el.nextQuestionBtn.hidden = !answered;
    el.guessActions.hidden = answered;
    el.hintBtn.disabled = !t.awaiting || (t.feedback && t.feedback.type === 'hint');
    el.skipBtn.disabled = !t.awaiting;

    if (t.feedback) {
      if (t.feedback.type === 'hint') {
        setCoach('hint', 'A nudge', 'The move starts on ' + Chess.indexToSquare(expected.from) + '.');
      } else if (t.feedback.type === 'correct') {
        setCoach('correct', 'That is the move.',
          expected.san + ' — exactly what ' + playerName(game, expected.color) + ' played.' +
          (expected.comment ? ' ' + expected.comment : ''));
      } else if (t.feedback.type === 'wrong') {
        setCoach('wrong', 'Not this time.',
          'You played ' + t.feedback.userSan + '. The score sheet says ' + expected.san + '.');
      } else if (t.feedback.type === 'skip') {
        setCoach('skip', 'Skipped.',
          'The game move was ' + expected.san + '. Keep the pattern for next time.');
      }
    } else {
      setCoach('default', 'Find the game move',
        (expected.color === 'w' ? 'White' : 'Black') + ' to move. Play the move from the score sheet.');
    }

    el.nextQuestionBtn.textContent = '';
    el.nextQuestionBtn.appendChild(document.createTextNode(
      t.index >= total - 1 ? 'See results' : 'Next position'
    ));
    el.nextQuestionBtn.appendChild(document.createTextNode(' '));
    var nextSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    nextSvg.setAttribute('class', 'ico');
    nextSvg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-arrow-right');
    nextSvg.appendChild(use);
    el.nextQuestionBtn.appendChild(nextSvg);
  }

  function resolveGuessAttempt(move, userSan, afterPosition) {
    var game = currentGame();
    var t = state.train;
    if (!game || !t.awaiting) return;
    var targetIndex = t.questions[t.index];
    var expected = game.moves[targetIndex];
    var correct = move.uci === expected.uci;

    t.attempts++;
    if (correct) {
      t.correct++;
      t.streak++;
      state.stats.guessCorrect++;
    } else {
      t.streak = 0;
    }
    state.stats.guessAttempts++;
    state.stats.guessBestStreak = Math.max(state.stats.guessBestStreak, t.streak);
    saveStats();
    updateStatsDisplay();

    state.ply = targetIndex + 1;
    t.awaiting = false;
    t.feedback = {
      type: correct ? 'correct' : 'wrong',
      from: move.from,
      to: expected.to,
      wrongFrom: move.from,
      wrongTo: move.to,
      userSan: userSan,
      correctSan: expected.san
    };
    if (correct) {
      t.feedback.to = move.to;
      t.feedback.wrongFrom = null;
      t.feedback.wrongTo = null;
    }
    renderMain();
    updateSessionPanel();
    updateTrainingDot();
  }

  function useHint() {
    var game = currentGame();
    var t = state.train;
    if (!game || !t.active || !t.awaiting) return;
    var expected = game.moves[t.questions[t.index]];
    state.selection = null;
    state.selectedMoves = [];
    t.hintFrom = expected.from;
    t.feedback = { type: 'hint' };
    setCoach('hint', 'A nudge', 'The move starts on ' + Chess.indexToSquare(expected.from) + '.');
    renderBoard();
    updateSessionPanel();
  }

  function skipQuestion() {
    var game = currentGame();
    var t = state.train;
    if (!game || !t.active || !t.awaiting) return;
    var expected = game.moves[t.questions[t.index]];
    t.attempts++;
    t.streak = 0;
    state.stats.guessAttempts++;
    saveStats();
    updateStatsDisplay();
    state.ply = t.questions[t.index] + 1;
    state.selection = null;
    state.selectedMoves = [];
    t.awaiting = false;
    t.hintFrom = null;
    t.feedback = {
      type: 'skip',
      to: expected.to,
      wrongFrom: null,
      wrongTo: null,
      correctSan: expected.san
    };
    renderMain();
    updateSessionPanel();
  }

  function nextQuestion() {
    var t = state.train;
    if (!t.active || t.awaiting) return;
    if (t.index >= t.questions.length - 1) {
      finishGuessSession();
      return;
    }
    loadGuessQuestion(t.index + 1);
  }

  function finishGuessSession() {
    var t = state.train;
    var total = t.questions.length;
    var accuracy = total ? Math.round((t.correct / total) * 100) : 0;
    t.active = false;
    t.summaryMode = 'guess';
    state.coords.active = false;
    setReaderLocked(false);
    el.trainSession.hidden = true;
    el.trainSummary.hidden = false;
    document.body.classList.add('is-training');
    el.summaryTitle.textContent = accuracy === 100 ? 'Flawless recall.'
      : accuracy >= 70 ? 'A sharp read.'
      : accuracy > 0 ? 'Patterns are forming.'
      : 'The board rewards repetition.';
    el.summaryAccuracy.textContent = accuracy + '%';
    el.summaryScore.textContent = t.correct + ' of ' + total + ' game moves found';
    el.summaryNote.textContent = accuracy === 100
      ? 'You read the whole line like a familiar story.'
      : accuracy >= 70
        ? 'The ideas are taking hold. One more pass will deepen them.'
        : accuracy > 0
          ? 'Every rep makes the pattern a little more familiar.'
          : 'Read the game once more, then let the board ask again.';
    el.trainAgainBtn.innerHTML = icon('i-refresh') + ' Practice again';
    el.backToSetupBtn.textContent = 'Back to practice';
    renderTransport();
    recordPracticeDay();
    renderStatsAfterSession();
    revealSummary();
  }

  function renderStatsAfterSession() {
    updateStatsDisplay();
    updateStreakDisplay();
    updateTrainingDot();
  }

  function exitGuessSession() {
    var t = state.train;
    t.active = false;
    t.awaiting = false;
    t.feedback = null;
    t.questions = [];
    t.config = null;
    t.summaryMode = null;
    document.body.classList.remove('is-training');
    el.trainSession.hidden = true;
    el.trainSummary.hidden = true;
    el.trainIdle.hidden = false;
    setReaderLocked(false);
    state.ply = clamp(t.returnPly, 0, currentGame() ? currentGame().moves.length : 0);
    state.selection = null;
    state.selectedMoves = [];
    setCoach('default', 'Find the game move', 'White to move. Play the move from the score sheet.');
    renderMain();
    updateTrainSetup();
    updateTrainingDot();
    window.setTimeout(focusPracticePage, 30);
  }

  function backToSetup() {
    if (state.train.summaryMode === 'guess') {
      state.train.summaryMode = null;
      el.trainSummary.hidden = true;
      el.trainIdle.hidden = false;
      state.ply = clamp(state.train.returnPly, 0, currentGame() ? currentGame().moves.length : 0);
      setReaderLocked(false);
      renderMain();
      updateTrainSetup();
    } else if (state.train.summaryMode === 'coords') {
      state.train.summaryMode = null;
      el.trainSummary.hidden = true;
      exitCoords(false);
      el.trainIdle.hidden = false;
      renderMain();
      updateTrainSetup();
    }
    document.body.classList.remove('is-training');
    if (window.matchMedia('(max-width: 940px)').matches) {
      window.setTimeout(function () {
        setTab('train');
        el.trainIdle.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }, 80);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function trainAgain() {
    if (state.train.summaryMode === 'coords') {
      el.trainSummary.hidden = true;
      state.train.summaryMode = null;
      startCoordSession();
      return;
    }
    var config = state.train.config;
    el.trainSummary.hidden = true;
    state.train.summaryMode = null;
    startGuessSession(config || undefined);
  }

  /* =========================================================
     Training — coordinates
     ========================================================= */

  function randomSquare(except) {
    var square;
    do {
      var file = Math.floor(Math.random() * 8);
      var rank = 1 + Math.floor(Math.random() * 8);
      square = Chess.FILES[file] + rank;
    } while (square === except);
    return square;
  }

  function startCoordSession() {
    clearPracticeTimers();
    stopAutoplay();
    if (state.explore) exitExplore(false);
    state.coords.returnPly = state.ply;
    state.coords.active = true;
    state.coords.running = true;
    state.coords.score = 0;
    state.coords.attempts = 0;
    state.coords.streak = 0;
    state.coords.target = randomSquare();
    state.coords.endAt = Date.now() + 60000;
    state.coords.flash = null;
    state.train.active = false;
    state.train.awaiting = false;
    state.train.summaryMode = null;

    el.trainIdle.hidden = true;
    el.trainSession.hidden = true;
    el.trainSummary.hidden = true;
    el.coordSession.hidden = false;
    setTab('train');
    setReaderLocked(true);
    document.body.classList.add('is-training');
    renderMain();
    updateCoordUI();
    state.coords.timer = window.setInterval(tickCoords, 250);
    tickCoords();
    updateTrainingDot();
    window.setTimeout(focusPracticePage, 30);
  }

  function tickCoords() {
    if (!state.coords.running) return;
    var remaining = Math.max(0, state.coords.endAt - Date.now());
    var seconds = Math.ceil(remaining / 1000);
    el.coordTimeLabel.textContent = seconds + 's';
    el.coordTimeBar.style.width = Math.round((remaining / 60000) * 100) + '%';
    if (remaining <= 0) finishCoordSession();
  }

  function updateCoordUI() {
    el.coordTarget.textContent = state.coords.target;
    el.coordScore.textContent = String(state.coords.score);
    el.coordStreakNow.textContent = String(state.coords.streak);
    el.coordAccuracy.textContent = state.coords.attempts
      ? Math.round((state.coords.score / state.coords.attempts) * 100) + '%'
      : '—';
    var seconds = Math.max(0, Math.ceil((state.coords.endAt - Date.now()) / 1000));
    el.coordTimeLabel.textContent = seconds + 's';
    el.coordTimeBar.style.width = Math.round((Math.max(0, state.coords.endAt - Date.now()) / 60000) * 100) + '%';
  }

  function handleCoordinateClick(index) {
    var c = state.coords;
    if (!c.active || !c.running) return;
    var square = Chess.indexToSquare(index);
    c.attempts++;
    if (square === c.target) {
      c.score++;
      c.streak++;
      state.stats.coordBest = Math.max(state.stats.coordBest || 0, c.score);
      state.stats.coordBestStreak = Math.max(state.stats.coordBestStreak || 0, c.streak);
      saveStats();
      updateStatsDisplay();
      c.flash = { correct: index };
      c.target = randomSquare(square);
      el.coordCoach.classList.remove('is-wrong');
      el.coordCoach.classList.add('is-correct');
      el.coordCoachTitle.textContent = 'Found it.';
      el.coordCoachText.textContent = 'Next square: ' + c.target + '. Keep the rhythm.';
    } else {
      c.streak = 0;
      c.flash = { wrong: index, target: Chess.squareToIndex(c.target) };
      el.coordCoach.classList.remove('is-correct');
      el.coordCoach.classList.add('is-wrong');
      el.coordCoachTitle.textContent = 'Not quite.';
      el.coordCoachText.textContent = 'That square is ' + square + '. Find ' + c.target + '.';
    }
    updateCoordUI();
    renderBoard();
    if (c.flashTimer) window.clearTimeout(c.flashTimer);
    c.flashTimer = window.setTimeout(function () {
      c.flash = null;
      renderBoard();
    }, 420);
  }

  function finishCoordSession() {
    var c = state.coords;
    if (!c.running) return;
    c.running = false;
    if (c.timer) {
      window.clearInterval(c.timer);
      c.timer = null;
    }
    state.stats.coordBest = Math.max(state.stats.coordBest || 0, c.score);
    state.stats.coordBestStreak = Math.max(state.stats.coordBestStreak || 0, c.streak);
    saveStats();
    recordPracticeDay();
    state.train.summaryMode = 'coords';
    el.coordSession.hidden = true;
    el.trainSummary.hidden = false;
    el.summaryTitle.textContent = c.score >= 20 ? 'Board vision.'
      : c.score >= 12 ? 'The squares are speaking.'
      : c.score > 0 ? 'A good first sweep.'
      : 'The board waits.';
    el.summaryAccuracy.textContent = String(c.score);
    el.summaryScore.textContent = 'squares found in 60 seconds';
    el.summaryNote.textContent = c.score >= 20
      ? 'Coordinates are becoming second nature. Try to beat your best.'
      : 'The edges are your anchors. Name the file, then the rank.';
    el.trainAgainBtn.innerHTML = icon('i-refresh') + ' Drill again';
    el.backToSetupBtn.textContent = 'Back to practice';
    updateStatsDisplay();
    updateTrainingDot();
    revealSummary();
  }

  function exitCoords(shouldResetBoard) {
    var c = state.coords;
    c.running = false;
    c.active = false;
    c.flash = null;
    if (c.timer) {
      window.clearInterval(c.timer);
      c.timer = null;
    }
    if (c.flashTimer) {
      window.clearTimeout(c.flashTimer);
      c.flashTimer = null;
    }
    el.coordSession.hidden = true;
    el.trainSummary.hidden = true;
    el.trainIdle.hidden = false;
    state.train.summaryMode = null;
    document.body.classList.remove('is-training');
    setReaderLocked(false);
    if (shouldResetBoard !== false) {
      state.ply = clamp(c.returnPly, 0, currentGame() ? currentGame().moves.length : 0);
      renderMain();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    updateTrainingDot();
  }

  /* =========================================================
     Imports
     ========================================================= */

  function openImport() {
    el.importDialog.showModal();
    resetImportDialog();
    window.setTimeout(function () {
      if (state.importMode === 'paste') el.pgnInput.focus();
    }, 60);
  }

  function resetImportDialog() {
    el.importError.hidden = true;
    el.importError.textContent = '';
    el.pgnInput.value = '';
    state.pendingFileText = '';
    state.pendingFileName = '';
    el.fileInput.value = '';
    setImportMode('paste');
    setFileZoneDefault();
  }

  function closeImport() {
    if (el.importDialog.open) el.importDialog.close();
    state.pendingFileText = '';
    state.pendingFileName = '';
  }

  function setImportMode(mode) {
    state.importMode = mode;
    document.querySelectorAll('.import-tab').forEach(function (tab) {
      var active = tab.dataset.import === mode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    el.pastePane.hidden = mode !== 'paste';
    el.filePane.hidden = mode !== 'file';
    el.importError.hidden = true;
  }

  function setFileZoneDefault() {
    var strong = el.fileZone.querySelector('strong');
    var small = el.fileZone.querySelector('small');
    if (strong) strong.textContent = 'Select a .pgn file';
    if (small) small.textContent = 'or drag and drop it anywhere on this page';
    el.fileZone.classList.remove('has-file');
  }

  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('Could not read the file.')); };
      reader.readAsText(file);
    });
  }

  function importPgnText(text, label) {
    var parsed = PGN.parse(text);
    if (!parsed.games.length) {
      throw new Error(parsed.errors[0] || 'No readable games were found in this PGN.');
    }
    state.search = '';
    state.filter = 'all';
    el.gameSearch.value = '';
    document.querySelectorAll('.filter-chip').forEach(function (chip) {
      chip.classList.toggle('is-active', chip.dataset.filter === 'all');
    });
    var createdAt = Date.now();
    var newGames = parsed.games.map(function (game) {
      var created = new Date(createdAt);
      game.headers.Imported = game.headers.Imported || 'Gambit';
      var prepared = prepareGame(game, newId(), 'imported');
      prepared.createdAt = created.getTime();
      prepared.importLabel = label || '';
      return prepared;
    });

    newGames.forEach(function (game, index) {
      state.games.splice(index, 0, game);
    });
    state.selectedId = newGames[0].id;
    state.ply = 0;
    state.explore = null;
    state.selection = null;
    state.selectedMoves = [];
    persistImported();
    resetPracticeForGameChange();
    renderAll();
    savePrefs();
    return { games: newGames, errors: parsed.errors };
  }

  function handleImportSubmit(event) {
    event.preventDefault();
    var text = state.importMode === 'file' ? state.pendingFileText : el.pgnInput.value;
    if (!text || !text.trim()) {
      showImportError(state.importMode === 'file' ? 'Choose a PGN file first.' : 'Paste a PGN first.');
      return;
    }
    try {
      var result = importPgnText(text, state.pendingFileName);
      closeImport();
      var count = result.games.length;
      toast(count + (count === 1 ? ' game' : ' games') + ' added to your library.' +
        (result.errors.length ? ' ' + result.errors.length + ' unreadable game section' +
          (result.errors.length === 1 ? '' : 's') + ' skipped.' : ''));
      setTab('moves');
    } catch (error) {
      showImportError(error.message || 'The PGN could not be read.');
    }
  }

  function showImportError(message) {
    el.importError.textContent = message;
    el.importError.hidden = false;
  }

  async function handleDroppedFiles(files) {
    var fileList = Array.prototype.slice.call(files || []);
    if (!fileList.length) return;
    if (el.importDialog.open) closeImport();
    if (fileList.length === 1) {
      try {
        var text = await readFileText(fileList[0]);
        var result = importPgnText(text, fileList[0].name);
        var count = result.games.length;
        toast(count + (count === 1 ? ' game' : ' games') + ' imported from ' + fileList[0].name + '.');
        setTab('moves');
      } catch (error) {
        toast(error.message || 'Could not import that file.', 'error');
      }
      return;
    }

    var good = 0;
    var skipped = 0;
    for (var i = 0; i < fileList.length; i++) {
      try {
        var fileText = await readFileText(fileList[i]);
        var parsed = importPgnText(fileText, fileList[i].name);
        good += parsed.games.length;
        skipped += parsed.errors.length;
      } catch (error) {
        skipped++;
      }
    }
    if (good) toast(good + ' games imported.' + (skipped ? ' ' + skipped + ' section(s) skipped.' : ''));
    else toast('No readable PGN files were found.', 'error');
  }

  /* =========================================================
     Tabs, dialogs, toast and clipboard
     ========================================================= */

  function setTab(name) {
    state.tab = name;
    document.querySelectorAll('.studio-tab').forEach(function (tab) {
      var active = tab.dataset.tab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    el.panelMoves.hidden = name !== 'moves';
    el.panelTrain.hidden = name !== 'train';
    el.panelDetails.hidden = name !== 'details';
    if (name === 'train') updateTrainSetup();
  }

  function toast(message, type) {
    var node = make('div', 'toast' + (type === 'error' ? ' is-error' : ''));
    node.appendChild(make('span', 'toast-mark'));
    node.appendChild(make('span', null, message));
    el.toastStack.appendChild(node);
    window.setTimeout(function () {
      node.classList.add('is-leaving');
      window.setTimeout(function () { node.remove(); }, 220);
    }, 3400);
  }

  function copyText(text, message) {
    var succeed = function () { toast(message || 'Copied.'); };
    var fallback = function () {
      try {
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', 'readonly');
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
        succeed();
      } catch (error) {
        toast('Copying is not available in this browser.', 'error');
      }
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(succeed).catch(fallback);
    } else {
      fallback();
    }
  }

  function copyCurrentPgn() {
    var game = currentGame();
    if (!game) return;
    copyText(game.pgn || PGN.build(game), 'PGN copied to clipboard.');
  }

  function removeCurrentGame() {
    var game = currentGame();
    if (!game || game.source !== 'imported') return;
    if (el.deleteGameBtn.dataset.confirm !== game.id) {
      el.deleteGameBtn.dataset.confirm = game.id;
      el.deleteGameBtn.innerHTML = icon('i-trash') + ' Click again to remove';
      window.setTimeout(function () {
        if (currentGame() && currentGame().id === game.id) {
          el.deleteGameBtn.dataset.confirm = '';
          el.deleteGameBtn.innerHTML = icon('i-trash') + ' Remove from library';
        }
      }, 3200);
      return;
    }
    state.games = state.games.filter(function (item) { return item.id !== game.id; });
    state.favorites.delete(game.id);
    writeJSON(STORAGE.favorites, Array.from(state.favorites));
    persistImported();
    var next = state.games[0];
    if (next) {
      state.selectedId = next.id;
      state.ply = 0;
    }
    state.explore = null;
    state.selection = null;
    state.selectedMoves = [];
    state.search = '';
    state.filter = 'all';
    el.gameSearch.value = '';
    document.querySelectorAll('.filter-chip').forEach(function (chip) {
      chip.classList.toggle('is-active', chip.dataset.filter === 'all');
    });
    resetPracticeForGameChange();
    renderAll();
    savePrefs();
    toast('Game removed from your library.');
  }

  function openMobileLibrary() {
    el.libraryPanel.classList.add('is-open');
    el.mobileScrim.hidden = false;
    document.body.classList.add('library-open');
  }

  function closeMobileLibrary() {
    el.libraryPanel.classList.remove('is-open');
    el.mobileScrim.hidden = true;
    document.body.classList.remove('library-open');
  }

  /* =========================================================
     Event wiring
     ========================================================= */

  function cacheDom() {
    [
      'streakPill', 'streakCount', 'shortcutsBtn', 'importBtn', 'mobileLibraryBtn',
      'libraryPanel', 'libraryClose', 'gameCount', 'gameSearch', 'gameList', 'libraryMeta',
      'dropCard', 'contextEvent', 'contextRound', 'contextPlayers', 'starBtn', 'flipBtn',
      'copyPgnBtn', 'topName', 'topTitle', 'topCaptures', 'topMaterial', 'playerTop',
      'bottomName', 'bottomTitle', 'bottomCaptures', 'bottomMaterial', 'playerBottom',
      'board', 'promotionMenu', 'boardEval', 'firstBtn', 'prevBtn', 'playBtn', 'nextBtn',
      'lastBtn', 'timeline', 'timelineMove', 'timelineTurn', 'exploreBar', 'exitExploreBtn',
      'panelMoves', 'panelTrain', 'panelDetails', 'moveLog', 'movesCopyBtn', 'noteCard',
      'noteLabel', 'noteMove', 'noteText', 'momentCount', 'momentList', 'trainIdle',
      'trainSession', 'coordSession', 'trainSummary', 'guessSetup', 'colorChoice',
      'startChoice', 'questionEstimate', 'questionEstimateNote', 'startGuessBtn',
      'guessStats', 'statAttempts', 'statAccuracy', 'statBestStreak', 'coordSetup',
      'coordDemo', 'coordBest', 'coordStreak', 'startCoordBtn', 'sessionEyebrow',
      'sessionPrompt', 'exitTrainBtn', 'sessionProgressBar', 'sessionProgressText',
      'sessionScore', 'coachCard', 'coachIcon', 'coachTitle', 'coachText', 'guessActions',
      'hintBtn', 'skipBtn', 'nextQuestionBtn', 'sessionStreak', 'sessionCorrect',
      'sessionAccuracy', 'summaryTitle', 'summaryAccuracy', 'summaryScore', 'summaryNote',
      'trainAgainBtn', 'backToSetupBtn', 'detailTitle', 'detailStarBtn', 'resultBanner',
      'detailWhite', 'detailBlack', 'detailResult', 'metaEvent', 'metaSite', 'metaDate',
      'metaRound', 'metaOpening', 'metaMoves', 'detailNoteCount', 'insightGrid', 'pgnRaw',
      'detailCopyBtn', 'deleteGameBtn', 'coordTarget', 'coordTimeBar', 'coordTimeLabel',
      'coordScore', 'coordStreakNow', 'coordAccuracy', 'coordCoach', 'coordCoachTitle',
      'coordCoachText', 'exitCoordBtn', 'importDialog', 'importForm', 'closeImportBtn',
      'cancelImportBtn', 'confirmImportBtn', 'pgnInput', 'loadSampleBtn', 'fileZone',
      'fileInput', 'importError', 'pastePane', 'filePane', 'shortcutsDialog',
      'closeShortcutsBtn', 'toastStack', 'dropOverlay', 'mobileScrim', 'brandHome'
    ].forEach(function (id) {
      el[id] = $(id);
    });
  }

  function wireEvents() {
    el.importBtn.addEventListener('click', openImport);
    el.dropCard.addEventListener('click', openImport);
    el.closeImportBtn.addEventListener('click', closeImport);
    el.cancelImportBtn.addEventListener('click', closeImport);
    el.importForm.addEventListener('submit', handleImportSubmit);
    el.importDialog.addEventListener('close', function () {
      state.pendingFileText = '';
      state.pendingFileName = '';
    });
    el.importDialog.addEventListener('click', function (event) {
      if (event.target === el.importDialog) closeImport();
    });

    document.querySelectorAll('.import-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        setImportMode(tab.dataset.import);
        if (tab.dataset.import === 'paste') el.pgnInput.focus();
      });
    });

    el.fileZone.addEventListener('click', function () { el.fileInput.click(); });
    el.fileInput.addEventListener('change', function () {
      var file = el.fileInput.files && el.fileInput.files[0];
      if (!file) return;
      readFileText(file).then(function (text) {
        state.pendingFileText = text;
        state.pendingFileName = file.name;
        var strong = el.fileZone.querySelector('strong');
        var small = el.fileZone.querySelector('small');
        if (strong) strong.textContent = file.name;
        if (small) small.textContent = Math.max(1, Math.round(file.size / 1024)) + ' KB · ready to import';
        el.fileZone.classList.add('has-file');
        el.importError.hidden = true;
      }).catch(function (error) {
        showImportError(error.message || 'Could not read that file.');
      });
    });

    el.loadSampleBtn.addEventListener('click', function () {
      var sample = SAMPLES[SAMPLES.length - 1];
      if (sample) {
        el.pgnInput.value = sample.pgn;
        el.importError.hidden = true;
      }
    });

    el.starBtn.addEventListener('click', function () {
      var game = currentGame();
      if (game) toggleFavorite(game.id);
    });
    el.detailStarBtn.addEventListener('click', function () {
      var game = currentGame();
      if (game) toggleFavorite(game.id);
    });

    el.flipBtn.addEventListener('click', function () {
      state.flipped = !state.flipped;
      state.selection = null;
      state.selectedMoves = [];
      savePrefs();
      renderBoard();
      renderPlayers();
    });

    el.copyPgnBtn.addEventListener('click', copyCurrentPgn);
    el.movesCopyBtn.addEventListener('click', copyCurrentPgn);
    el.detailCopyBtn.addEventListener('click', copyCurrentPgn);

    el.firstBtn.addEventListener('click', function () { goToPly(0); });
    el.prevBtn.addEventListener('click', function () { navigate(-1); });
    el.nextBtn.addEventListener('click', function () { navigate(1); });
    el.lastBtn.addEventListener('click', function () {
      var game = currentGame();
      if (game) goToPly(game.moves.length);
    });
    el.playBtn.addEventListener('click', toggleAutoplay);
    el.timeline.addEventListener('input', function () {
      goToPly(Number(el.timeline.value));
    });
    el.exitExploreBtn.addEventListener('click', function () { exitExplore(); });

    el.board.addEventListener('click', onBoardClick);

    el.gameSearch.addEventListener('input', function () {
      state.search = el.gameSearch.value;
      renderLibrary();
    });

    document.querySelectorAll('.filter-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        state.filter = chip.dataset.filter;
        document.querySelectorAll('.filter-chip').forEach(function (other) {
          other.classList.toggle('is-active', other === chip);
        });
        renderLibrary();
      });
    });

    document.querySelectorAll('.studio-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { setTab(tab.dataset.tab); });
    });

    document.querySelectorAll('.mode-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        if (state.train.active || state.coords.active) return;
        state.train.mode = button.dataset.mode;
        setModeUI();
      });
    });

    document.querySelectorAll('#colorChoice .seg').forEach(function (button) {
      button.addEventListener('click', function () {
        state.train.color = button.dataset.color;
        document.querySelectorAll('#colorChoice .seg').forEach(function (other) {
          other.classList.toggle('is-active', other === button);
        });
        updateTrainSetup();
      });
    });

    document.querySelectorAll('#startChoice .seg').forEach(function (button) {
      button.addEventListener('click', function () {
        state.train.startChoice = button.dataset.start;
        document.querySelectorAll('#startChoice .seg').forEach(function (other) {
          other.classList.toggle('is-active', other === button);
        });
        updateTrainSetup();
      });
    });

    el.startGuessBtn.addEventListener('click', function () { startGuessSession(); });
    el.startCoordBtn.addEventListener('click', function () { startCoordSession(); });
    el.hintBtn.addEventListener('click', useHint);
    el.skipBtn.addEventListener('click', skipQuestion);
    el.nextQuestionBtn.addEventListener('click', nextQuestion);
    el.exitTrainBtn.addEventListener('click', exitGuessSession);
    el.exitCoordBtn.addEventListener('click', function () { exitCoords(true); });
    el.trainAgainBtn.addEventListener('click', trainAgain);
    el.backToSetupBtn.addEventListener('click', backToSetup);

    el.deleteGameBtn.addEventListener('click', removeCurrentGame);

    el.mobileLibraryBtn.addEventListener('click', openMobileLibrary);
    el.libraryClose.addEventListener('click', closeMobileLibrary);
    el.mobileScrim.addEventListener('click', closeMobileLibrary);

    el.shortcutsBtn.addEventListener('click', function () { el.shortcutsDialog.showModal(); });
    el.closeShortcutsBtn.addEventListener('click', function () { el.shortcutsDialog.close(); });
    el.shortcutsDialog.addEventListener('click', function (event) {
      if (event.target === el.shortcutsDialog) el.shortcutsDialog.close();
    });

    el.brandHome.addEventListener('click', function (event) {
      event.preventDefault();
      if (state.games.length) {
        var opera = gameById('sample-opera') || state.games[0];
        if (state.selectedId === opera.id) {
          goToPly(0);
          setTab('moves');
        } else {
          selectGame(opera.id);
        }
      }
    });

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        stopAutoplay();
        if (state.coords.running) tickCoords();
      }
    });

    window.addEventListener('dragenter', function (event) {
      if (!event.dataTransfer || Array.prototype.indexOf.call(event.dataTransfer.types, 'Files') === -1) return;
      event.preventDefault();
      state.dragDepth++;
      el.dropOverlay.hidden = false;
    });
    window.addEventListener('dragover', function (event) {
      if (!event.dataTransfer || Array.prototype.indexOf.call(event.dataTransfer.types, 'Files') === -1) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', function (event) {
      if (!event.dataTransfer || Array.prototype.indexOf.call(event.dataTransfer.types, 'Files') === -1) return;
      state.dragDepth = Math.max(0, state.dragDepth - 1);
      if (!state.dragDepth) el.dropOverlay.hidden = true;
    });
    window.addEventListener('drop', function (event) {
      if (!event.dataTransfer || !event.dataTransfer.files || !event.dataTransfer.files.length) return;
      event.preventDefault();
      state.dragDepth = 0;
      el.dropOverlay.hidden = true;
      handleDroppedFiles(event.dataTransfer.files);
    });

    window.addEventListener('beforeunload', savePrefs);
  }

  function onKeyDown(event) {
    var target = event.target;
    var tag = target && target.tagName ? target.tagName.toLowerCase() : '';
    if (target && (target.isContentEditable || /^(input|textarea|select)$/.test(tag))) return;
    if (document.querySelector('dialog[open]')) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === 'Escape') {
      if (state.pendingPromotion) {
        event.preventDefault();
        state.pendingPromotion = null;
        el.promotionMenu.hidden = true;
        state.selection = null;
        state.selectedMoves = [];
        renderBoard();
        return;
      }
      if (el.libraryPanel.classList.contains('is-open')) {
        closeMobileLibrary();
        return;
      }
    }

    if (state.train.active || state.coords.active) return;

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        navigate(-1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        navigate(1);
        break;
      case 'Home':
        event.preventDefault();
        goToPly(0);
        break;
      case 'End':
        event.preventDefault();
        var finalGame = currentGame();
        if (finalGame) goToPly(finalGame.moves.length);
        break;
      case ' ':
        event.preventDefault();
        toggleAutoplay();
        break;
      case 'f':
      case 'F':
        event.preventDefault();
        el.flipBtn.click();
        break;
      case 'i':
      case 'I':
        event.preventDefault();
        openImport();
        break;
      case '/':
        event.preventDefault();
        el.gameSearch.focus();
        break;
      case '?':
        event.preventDefault();
        el.shortcutsDialog.showModal();
        break;
    }
  }

  /* =========================================================
     Boot
     ========================================================= */

  function init() {
    cacheDom();
    state.stats = loadStats();
    var prefs = loadPrefs();
    state.flipped = !!prefs.flipped;

    var favorites = readJSON(STORAGE.favorites, []);
    if (Array.isArray(favorites)) {
      state.favorites = new Set(favorites.filter(function (id) { return typeof id === 'string'; }));
    }

    loadInitialGames();
    if (!state.games.length) {
      toast('The sample games could not be loaded.', 'error');
      return;
    }

    var preferred = prefs.lastGameId ? gameById(prefs.lastGameId) : null;
    var initial = preferred || gameById('sample-opera') || state.games[0];
    state.selectedId = initial.id;
    state.ply = preferred ? clamp(Number(prefs.lastPly) || 0, 0, initial.moves.length) : 0;

    wireEvents();
    setModeUI();
    setTab('moves');
    renderAll();
    updateStatsDisplay();
    updateStreakDisplay();
    savePrefs();

    window.setTimeout(function () {
      document.body.classList.add('is-ready');
    }, 60);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

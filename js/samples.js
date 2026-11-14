/* Five annotated classics, bundled so the room is never empty. */
(function (global) {
  'use strict';

  global.GAMBIT_SAMPLES = [
    {
      id: 'sample-opera',
      pgn: `[Event "The Opera Game"]
[Site "Paris, France"]
[Date "1858.??.??"]
[Round "?"]
[White "Paul Morphy"]
[Black "Duke Karl & Count Isouard"]
[Result "1-0"]
[Opening "Italian Game"]
[ECO "C50"]
[Annotator "Gambit study notes"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 {Black pins the knight, but the bishop will not survive the centre.} 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ {The queen is offered to clear the final rank.} Nxb8 17. Rd8# {Mate with a lone rook. Every white piece except the king and rook has left the board.} 1-0`
    },
    {
      id: 'sample-immortal',
      pgn: `[Event "The Immortal Game"]
[Site "London, England"]
[Date "1851.??.??"]
[Round "?"]
[White "Adolf Anderssen"]
[Black "Lionel Kieseritzky"]
[Result "1-0"]
[Opening "King's Gambit Accepted"]
[ECO "C33"]
[Annotator "Gambit study notes"]

1. e4 e5 2. f4 exf4 3. Bc4 Qh4+ 4. Kf1 b5 5. Bxb5 Nf6 6. Nf3 Qh6 7. d3 Nh5 8. Nh4 Qg5 9. Nf5 c6 10. g4 Nf6 11. Rg1 cxb5 12. h4 Qg6 13. h5 Qg5 14. Qf3 Ng8 15. Bxf4 Qf6 16. Nc3 Bc5 17. Nd5 Qxb2 18. Bd6 {Anderssen offers both rooks to keep the attack alive.} Bxg1 19. e5 Qxa1+ 20. Ke2 Na6 21. Nxg7+ Kd8 22. Qf6+ Nxf6 23. Be7# {A bishop mate. Black's queen and both rooks are still on the board.} 1-0`
    },
    {
      id: 'sample-evergreen',
      pgn: `[Event "The Evergreen Game"]
[Site "Berlin, Germany"]
[Date "1852.??.??"]
[Round "?"]
[White "Adolf Anderssen"]
[Black "Jean Dufresne"]
[Result "1-0"]
[Opening "Evans Gambit"]
[ECO "C52"]
[Annotator "Gambit study notes"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. b4 Bxb4 5. c3 Ba5 6. d4 exd4 7. O-O d3 8. Qb3 Qf6 9. e5 Qg6 10. Re1 Nge7 11. Ba3 b5 12. Qxb5 Rb8 13. Qa4 Bb6 14. Nbd2 Bb7 15. Ne4 Qf5 16. Bxd3 Qh5 17. Nf6+ gxf6 18. exf6 Rg8 19. Rad1 Qxf3 20. Rxe7+ Nxe7 21. Qxd7+ Kxd7 22. Bf5+ Ke8 23. Bd7+ Kf8 24. Bxe7# {A quiet bishop delivers the final blow through a crowded board.} 1-0`
    },
    {
      id: 'sample-legall',
      pgn: `[Event "The Original Trap"]
[Site "Paris, France"]
[Date "1750.??.??"]
[Round "?"]
[White "Francois de Legall"]
[Black "Saint Brie"]
[Result "1-0"]
[Opening "Italian Game"]
[ECO "C50"]
[Annotator "Gambit study notes"]

1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 {Black has walked into the oldest trap in the book.} 5. Nxe5 {The bait: the white queen is left hanging on d1.} Bxd1 6. Bxf7+ Ke7 7. Nd5# {The knight's tour — Nxe5, Bxf7+, Nd5 — is a pattern every player should know.} 1-0`
    },
    {
      id: 'sample-reti',
      pgn: `[Event "The Queen Sacrifice"]
[Site "Vienna, Austria"]
[Date "1910.??.??"]
[Round "?"]
[White "Richard Reti"]
[Black "Savielly Tartakower"]
[Result "1-0"]
[Opening "Caro-Kann Defense"]
[ECO "B15"]
[Annotator "Gambit study notes"]

1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Nf6 5. Qd3 e5 6. dxe5 Qa5+ 7. Bd2 Qxe5 8. O-O-O {Reti castles into the fire. His queen is about to become a sacrifice.} Nxe4 9. Qd8+ {The queen is given up to drag the black king into a mating net.} Kxd8 10. Bg5+ Kc7 11. Bd8# {A bishop finishes the job from d8, the square the queen vacated.} 1-0`
    }
  ];
})(window);

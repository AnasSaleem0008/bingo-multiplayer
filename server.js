const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

const MAX_PLAYERS = 10;
const TURN_SECONDS = 30;
const MAX_CHAT_LENGTH = 200;


// ==============================
// HELPER FUNCTIONS
// ==============================

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }

  return array;
}


function makeBoard() {
  return shuffle(
    Array.from(
      { length: 100 },
      (_, i) => i + 1
    )
  );
}


function roomCode() {
  let code;

  do {
    code = Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase();
  } while (rooms.has(code));

  return code;
}


function publicPlayers(room) {
  return room.players
    .filter(p => p.active !== false)
    .map(p => ({
      id: p.id,
      name: p.name,
      lines: p.lines
    }));
}


function activePlayers(room) {
  return room.players.filter(
    p => p.active !== false
  );
}


function normalizeCurrentIndex(room) {
  const active = activePlayers(room);

  if (!active.length) {
    room.currentIndex = 0;
    return;
  }

  if (room.currentIndex >= active.length) {
    room.currentIndex = 0;
  }
}


function getRoom(socket) {
  return socket.data.roomCode
    ? rooms.get(socket.data.roomCode)
    : null;
}


function getPlayer(room, id) {
  return room?.players.find(
    p => p.id === id
  );
}


function cleanMessage(message) {
  return String(message || "")
    .trim()
    .slice(0, MAX_CHAT_LENGTH);
}


function calculateLines(board, called) {

  const size = 10;
  const complete = new Set();

  const check = (indexes, name) => {

    if (
      indexes.every(
        i => called.has(board[i])
      )
    ) {
      complete.add(name);
    }

  };


  for (let r = 0; r < size; r++) {

    check(
      Array.from(
        { length: size },
        (_, c) => r * size + c
      ),
      `row-${r}`
    );

  }


  for (let c = 0; c < size; c++) {

    check(
      Array.from(
        { length: size },
        (_, r) => r * size + c
      ),
      `col-${c}`
    );

  }


  check(
    Array.from(
      { length: size },
      (_, i) => i * size + i
    ),
    "diag1"
  );


  check(
    Array.from(
      { length: size },
      (_, i) =>
        i * size + (size - 1 - i)
    ),
    "diag2"
  );


  return complete.size;
}


// ==============================
// TIMER FUNCTIONS
// ==============================

function clearTimer(room) {

  if (room.timer) {
    clearTimeout(room.timer);
  }

  room.timer = null;
}


function startTurnTimer(code) {

  const room = rooms.get(code);

  if (!room || !room.started) {
    return;
  }

  clearTimer(room);

  room.turnStartedAt = Date.now();

  room.turnEndsAt =
    room.turnStartedAt +
    TURN_SECONDS * 1000;

  room.timer = setTimeout(
    () => autoSelect(code),
    TURN_SECONDS * 1000
  );
}


function advanceTurn(room) {

  const active = activePlayers(room);

  if (!active.length) {
    room.currentIndex = 0;
    return;
  }

  room.currentIndex =
    (room.currentIndex + 1) %
    active.length;
}

function removeActivePlayerFromTurn(room, playerId) {
  const before = activePlayers(room);
  const oldIndex = before.findIndex(p => p.id === playerId);
  const wasCurrent = oldIndex === room.currentIndex;

  if (oldIndex === -1) {
    return { wasCurrent: false };
  }

  // Removing a player before the current index shifts every later player left.
  if (!wasCurrent && oldIndex < room.currentIndex) {
    room.currentIndex -= 1;
  }

  const after = activePlayers(room);
  if (!after.length) {
    room.currentIndex = 0;
  } else if (room.currentIndex >= after.length) {
    room.currentIndex = 0;
  }

  return { wasCurrent };
}


function chooseRandomUncalled(room) {

  const remaining = [];

  for (let n = 1; n <= 100; n++) {

    if (!room.calledNumbers.has(n)) {
      remaining.push(n);
    }

  }

  return remaining[
    Math.floor(
      Math.random() * remaining.length
    )
  ];
}


// ==============================
// GAME FUNCTIONS
// ==============================

function finishOrAdvance(
  code,
  number,
  player,
  automatic = false
) {

  const room = rooms.get(code);

  if (!room) {
    return;
  }


  room.calledNumbers.add(number);


  for (const p of room.players) {

    p.called.add(number);

    p.lines = calculateLines(
      p.board,
      p.called
    );

  }


  const winner = room.players.find(
    p => p.lines >= 10
  );


  if (winner) {

    room.started = false;

    clearTimer(room);

    io.to(code).emit(
      "numberCalled",
      {
        number,
        playerName: player.name,
        automatic,
        nextTurn: null,
        nextTurnName: null,
        players: publicPlayers(room)
      }
    );


    io.to(code).emit(
      "gameOver",
      {
        winnerId: winner.id,
        winnerName: winner.name,
        players: publicPlayers(room)
      }
    );

    return;
  }


  advanceTurn(room);


  const next =
    activePlayers(room)[
      room.currentIndex
    ];


  startTurnTimer(code);


  io.to(code).emit(
    "numberCalled",
    {
      number,
      playerName: player.name,
      automatic,
      nextTurn: next.id,
      nextTurnName: next.name,
      turnEndsAt: room.turnEndsAt,
      players: publicPlayers(room)
    }
  );
}


function autoSelect(code) {

  const room = rooms.get(code);

  if (!room || !room.started) {
    return;
  }


  const active = activePlayers(room);

  const player =
    active[room.currentIndex];


  const number =
    chooseRandomUncalled(room);


  if (!player || number == null) {
    return;
  }


  finishOrAdvance(
    code,
    number,
    player,
    true
  );
}


// ==============================
// ROOM FUNCTIONS
// ==============================

function destroyRoom(code) {

  const room = rooms.get(code);

  if (!room) {
    return;
  }


  clearTimer(room);


  room.players.forEach(p => {

    const s =
      io.sockets.sockets.get(p.id);

    if (s) {
      s.leave(code);
      s.data.roomCode = null;
    }

  });


  rooms.delete(code);
}


function emitRoomUpdate(code) {

  const room = rooms.get(code);

  if (!room) {
    return;
  }


  io.to(code).emit(
    "roomUpdate",
    {
      code,
      hostId: room.hostId,
      started: room.started,
      players: publicPlayers(room)
    }
  );
}


// ==============================
// SOCKET CONNECTION
// ==============================

io.on("connection", socket => {


  // ==============================
  // CHAT
  // ==============================

  socket.on(
    "chatMessage",
    ({ message }) => {

      const code =
        socket.data.roomCode;

      const room =
        rooms.get(code);


      if (!room) {

        return socket.emit(
          "errorMessage",
          "You are not in a room."
        );

      }


      const player =
        getPlayer(
          room,
          socket.id
        );


      if (
        !player ||
        player.active === false
      ) {

        return socket.emit(
          "errorMessage",
          "You are not an active player."
        );

      }


      const clean =
        String(message || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(
            0,
            MAX_CHAT_LENGTH
          );


      if (!clean) {
        return;
      }


      io.to(code).emit(
        "chatMessage",
        {
          playerId: socket.id,
          playerName: player.name,
          message: clean,
          sentAt: Date.now()
        }
      );

    }
  );


  // ==============================
  // CREATE ROOM
  // ==============================

  socket.on(
    "createRoom",
    ({ name }) => {

      const cleanName =
        String(name || "Player")
          .trim()
          .slice(0, 16);


      const code =
        roomCode();


      const room = {

        code,

        hostId: socket.id,

        started: false,

        currentIndex: 0,

        calledNumbers: new Set(),

        players: [

          {
            id: socket.id,

            name:
              cleanName || "Player",

            board:
              makeBoard(),

            called:
              new Set(),

            lines: 0,

            active: true
          }

        ],

        timer: null,

        turnStartedAt: 0,

        turnEndsAt: 0

      };


      rooms.set(
        code,
        room
      );


      socket.join(code);

      socket.data.roomCode =
        code;


      socket.emit(
        "roomCreated",
        { code }
      );


      emitRoomUpdate(code);

    }
  );


  // ==============================
  // JOIN ROOM
  // ==============================

  socket.on(
    "joinRoom",
    ({ name, code }) => {

      code =
        String(code || "")
          .trim()
          .toUpperCase();


      const room =
        rooms.get(code);


      if (!room) {

        return socket.emit(
          "errorMessage",
          "Room not found."
        );

      }


      if (room.started) {

        return socket.emit(
          "errorMessage",
          "Game already started."
        );

      }


      if (
        room.players.length >=
        MAX_PLAYERS
      ) {

        return socket.emit(
          "errorMessage",
          "Room is full."
        );

      }


      const cleanName =
        String(name || "Player")
          .trim()
          .slice(0, 16);


      room.players.push({

        id: socket.id,

        name:
          cleanName || "Player",

        board:
          makeBoard(),

        called:
          new Set(),

        lines: 0,

        active: true

      });


      socket.join(code);

      socket.data.roomCode =
        code;


      socket.emit(
        "roomJoined",
        { code }
      );


      emitRoomUpdate(code);

    }
  );


  // ==============================
  // START GAME
  // ==============================

  socket.on(
    "startGame",
    () => {

      const code =
        socket.data.roomCode;

      const room =
        rooms.get(code);


      if (!room) {

        return socket.emit(
          "errorMessage",
          "You are not in a room."
        );

      }


      if (
        room.hostId !==
        socket.id
      ) {

        return socket.emit(
          "errorMessage",
          "Only the host can start the game."
        );

      }


      if (
        activePlayers(room).length < 2
      ) {

        return socket.emit(
          "errorMessage",
          "At least 2 active players are required."
        );

      }


      // Start/restart only with players who are still active.
      // Players who voluntarily left remain archived in the room and
      // must never be silently added back into the active player list.
      activePlayers(room).forEach(p => {
        p.called = new Set();
        p.lines = 0;
      });

      room.started = true;

      room.currentIndex = 0;

      room.calledNumbers =
        new Set();


      clearTimer(room);


      const current =
        activePlayers(room)[0];


      activePlayers(room).forEach(p => {

        io.to(p.id).emit(
          "gameStarted",
          {
            board: p.board,

            players:
              publicPlayers(room),

            currentTurn:
              current.id,

            currentTurnName:
              current.name,

            turnSeconds:
              TURN_SECONDS,

            turnEndsAt:
              Date.now() +
              TURN_SECONDS * 1000
          }
        );

      });


      emitRoomUpdate(code);

      startTurnTimer(code);

    }
  );


  // ==============================
  // SELECT NUMBER
  // ==============================

  socket.on(
    "selectNumber",
    ({ number }) => {

      const code =
        socket.data.roomCode;

      const room =
        rooms.get(code);


      if (
        !room ||
        !room.started
      ) {
        return;
      }


      const player =
        getPlayer(
          room,
          socket.id
        );


      if (!player) {
        return;
      }


      const current =
        activePlayers(room)[
          room.currentIndex
        ];


      if (
        !current ||
        current.id !== socket.id
      ) {

        return socket.emit(
          "errorMessage",
          "It is not your turn."
        );

      }


      number =
        Number(number);


      if (
        !Number.isInteger(number) ||
        number < 1 ||
        number > 100
      ) {

        return socket.emit(
          "errorMessage",
          "Invalid number."
        );

      }


      if (
        room.calledNumbers.has(number)
      ) {

        return socket.emit(
          "errorMessage",
          "That number has already been called."
        );

      }


      clearTimer(room);


      finishOrAdvance(
        code,
        number,
        player,
        false
      );

    }
  );


  // ==============================
  // LEAVE GAME
  // ==============================

  socket.on(
    "leaveGame",
    () => {

      const code =
        socket.data.roomCode;

      const room =
        rooms.get(code);


      if (
        !room ||
        !room.started
      ) {
        return;
      }


      const player =
        getPlayer(
          room,
          socket.id
        );


      if (
        !player ||
        player.active === false
      ) {
        return;
      }


      const activeBefore =
        activePlayers(room);


      const leavingWasCurrent =
        activeBefore[room.currentIndex]?.id === socket.id;


      player.active = false;
      removeActivePlayerFromTurn(room, socket.id);


      if (
        room.hostId ===
        socket.id
      ) {

        const replacement =
          activePlayers(room)[0];


        if (replacement) {
          room.hostId =
            replacement.id;
        }

      }


      const activeAfterLeave =
        activePlayers(room);


      if (
        activeAfterLeave.length < 2
      ) {

        room.started = false;

        clearTimer(room);

        room.currentIndex = 0;


        io.to(code).emit(
          "gameEnded",
          {
            reason:
              "Not enough active players to continue the game.",

            playerId:
              socket.id,

            playerName:
              player.name,

            players:
              publicPlayers(room)
          }
        );

      }

      else if (leavingWasCurrent) {

        clearTimer(room);


        const next =
          activePlayers(room)[
            room.currentIndex
          ];


        startTurnTimer(code);


        io.to(code).emit(
          "playerLeft",
          {
            nextTurn:
              next.id,

            nextTurnName:
              next.name,

            turnEndsAt:
              room.turnEndsAt,

            hostId:
              room.hostId,

            players:
              publicPlayers(room)
          }
        );

      }

      else {

        if (
          room.currentIndex >=
          activePlayers(room).length
        ) {

          room.currentIndex = 0;

        }


        io.to(code).emit(
          "playerLeft",
          {
            nextTurn:
              activePlayers(room)[
                room.currentIndex
              ]?.id || null,

            nextTurnName:
              activePlayers(room)[
                room.currentIndex
              ]?.name || null,

            turnEndsAt:
              room.turnEndsAt || 0,

            hostId:
              room.hostId,

            players:
              publicPlayers(room)
          }
        );

      }


      socket.emit(
        "gameLeft",
        {
          playerId:
            socket.id,

          playerName:
            player.name
        }
      );


      emitRoomUpdate(code);

    }
  );


  // ==============================
  // LEAVE ROOM
  // ==============================

  socket.on(
    "leaveRoom",
    () => {

      const code =
        socket.data.roomCode;

      const room =
        rooms.get(code);


      if (!room) {
        return;
      }


      const player =
        getPlayer(
          room,
          socket.id
        );


      if (room.started) {

        return socket.emit(
          "errorMessage",
          "Use Leave Game during an active game so your board and score remain visible."
        );

      }


      if (
        room.hostId ===
        socket.id
      ) {

        io.to(code).emit(
          "resetToLobby",
          "Host left. Room closed."
        );


        destroyRoom(code);

        return;
      }


      room.players =
        room.players.filter(
          p => p.id !== socket.id
        );


      socket.leave(code);

      socket.data.roomCode =
        null;


      socket.emit(
        "roomLeft"
      );


      if (
        room.players.length === 0
      ) {

        rooms.delete(code);

      }

      else {

        emitRoomUpdate(code);

      }

    }
  );


  // ==============================
  // DISCONNECT
  // ==============================

  socket.on(
    "disconnect",
    () => {

      const code =
        socket.data.roomCode;

      const room =
        rooms.get(code);


      if (!room) {
        return;
      }


      const player =
        getPlayer(
          room,
          socket.id
        );


      if (!player) {
        return;
      }


      if (room.started) {

        const activeBefore =
          activePlayers(room);


        const leavingWasCurrent =
          activeBefore[room.currentIndex]?.id === socket.id;


        player.active = false;
        removeActivePlayerFromTurn(room, socket.id);


        if (
          room.hostId ===
          socket.id
        ) {

          const replacement =
            activePlayers(room)[0];


          if (replacement) {
            room.hostId =
              replacement.id;
          }

        }


        const activeAfterDisconnect =
          activePlayers(room);


        if (
          activeAfterDisconnect.length < 2
        ) {

          room.started = false;

          clearTimer(room);

          room.currentIndex = 0;


          io.to(code).emit(
            "gameEnded",
            {
              reason:
                "Not enough active players to continue the game.",

              playerId:
                socket.id,

              playerName:
                player.name,

              players:
                publicPlayers(room)
            }
          );

        }

        else if (leavingWasCurrent) {

          clearTimer(room);


          room.currentIndex =
            room.currentIndex %
            activePlayers(room).length;


          const next =
            activePlayers(room)[
              room.currentIndex
            ];


          startTurnTimer(code);


          io.to(code).emit(
            "playerLeft",
            {
              nextTurn:
                next.id,

              nextTurnName:
                next.name,

              turnEndsAt:
                room.turnEndsAt,

              hostId:
                room.hostId,

              players:
                publicPlayers(room)
            }
          );

        }

        else {

          const next =
            activePlayers(room)[
              room.currentIndex
            ];


          io.to(code).emit(
            "playerLeft",
            {
              nextTurn:
                next?.id || null,

              nextTurnName:
                next?.name || null,

              turnEndsAt:
                room.turnEndsAt || 0,

              hostId:
                room.hostId,

              players:
                publicPlayers(room)
            }
          );

        }


        emitRoomUpdate(code);

      }

      else {

        if (
          room.hostId ===
          socket.id
        ) {

          io.to(code).emit(
            "resetToLobby",
            "Host disconnected. Room closed."
          );


          destroyRoom(code);

          return;
        }


        room.players =
          room.players.filter(
            p => p.id !== socket.id
          );


        if (
          room.players.length === 0
        ) {

          rooms.delete(code);

        }

        else {

          emitRoomUpdate(code);

        }

      }

    }
  );

});


// ==============================
// START SERVER
// ==============================

const PORT =
  process.env.PORT || 3000;

server.listen(
  PORT,
  () =>
    console.log(
      `Bingo server running on port ${PORT}`
    )
);

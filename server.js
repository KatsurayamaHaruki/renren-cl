const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

let rooms = {};
const initialWords = ["りんご", "ごりら", "らっぱ", "ぱんだ", "だいふく"];

io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('createRoom', (data) => {
    const { roomId, nickname } = data;
    rooms[roomId] = { 
      participants: [{ id: socket.id, name: nickname }],
      currentTurn: 0,
      gameState: {},
      parentIndex: 0
    };
    socket.join(roomId);
    io.to(roomId).emit('roomCreated', { roomId, participants: rooms[roomId].participants });
  });

  socket.on('joinRoom', (data) => {
    const { roomId, nickname } = data;
    if (rooms[roomId]) {
        rooms[roomId].participants.push({ id: socket.id, name: nickname });
        socket.join(roomId);
        // 参加したユーザーに個別に成功メッセージを送信
        socket.emit('joinedRoom', { roomId, participants: rooms[roomId].participants });
        // ルーム内の全員に更新された参加者リストを送信
        io.to(roomId).emit('updateParticipants', rooms[roomId].participants);
    } else {
        socket.emit('roomNotFound');
    }
  });

  socket.on('startGame', (roomId) => {
    if (rooms[roomId]) {
      rooms[roomId].gameState = initializeGameState(rooms[roomId].participants);
      io.to(roomId).emit('gameStarted', {
        gameState: rooms[roomId].gameState,
        parentIndex: rooms[roomId].parentIndex
      });
    }
  });

  socket.on('submitParentWords', (data) => {
    const { roomId, wordB, wordC } = data;
    if (rooms[roomId]) {
      rooms[roomId].gameState.wordB = wordB;
      rooms[roomId].gameState.wordC = wordC;
      io.to(roomId).emit('parentWordsSubmitted', { 
        wordA: rooms[roomId].gameState.wordA,
        wordB: wordB[0], 
        wordC: wordC[0] 
      });
    }
  });

  socket.on('submitChildGuess', (data) => {
    const { roomId, guess } = data;
    if (rooms[roomId]) {
      const result = processGuess(rooms[roomId].gameState, guess);
      io.to(roomId).emit('guessResult', {
        ...result,
        wordA: rooms[roomId].gameState.wordA,
        wordB: rooms[roomId].gameState.wordB,
        wordC: rooms[roomId].gameState.wordC,
        guess: guess
      });
    }
  });

  socket.on('nextTurn', (roomId) => {
    if (rooms[roomId]) {
      rooms[roomId].currentTurn++;
      rooms[roomId].parentIndex = (rooms[roomId].parentIndex + 1) % rooms[roomId].participants.length;
      if (rooms[roomId].currentTurn < rooms[roomId].participants.length * 3) {
        rooms[roomId].gameState = initializeGameState(rooms[roomId].participants);
        io.to(roomId).emit('newTurnStarted', {
          gameState: rooms[roomId].gameState,
          parentIndex: rooms[roomId].parentIndex
        });
      } else {
        io.to(roomId).emit('gameEnded', calculateFinalScores(rooms[roomId].gameState));
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected');
    for (let roomId in rooms) {
      rooms[roomId].participants = rooms[roomId].participants.filter(p => p.id !== socket.id);
      if (rooms[roomId].participants.length === 0) {
        delete rooms[roomId];
      } else {
        io.to(roomId).emit('updateParticipants', rooms[roomId].participants);
      }
    }
  });
});

function initializeGameState(participants) {
  return {
    wordA: initialWords[Math.floor(Math.random() * initialWords.length)],
    wordB: '',
    wordC: '',
    scores: participants.reduce((acc, p) => ({ ...acc, [p.id]: 0 }), {}),
    attempts: 0
  };
}

function processGuess(gameState, guess) {
  gameState.attempts++;
  if (guess === gameState.wordC) {
    if (gameState.attempts === 1) {
      // 子が1回で正解した場合、子に1ポイント
      gameState.scores[gameState.currentChild] += 1;
    } else {
      // 子が2回目で正解した場合、親に2ポイント
      gameState.scores[gameState.currentParent] += 2;
    }
    return { correct: true, scores: gameState.scores };
  } else if (gameState.attempts === 2) {
    return { correct: false, scores: gameState.scores, revealedAnswer: gameState.wordC };
  }
  return { correct: false, scores: gameState.scores };
}

function calculateFinalScores(gameState) {
  return Object.entries(gameState.scores)
    .sort((a, b) => b[1] - a[1])
    .map(([id, score], index) => ({ id, score, rank: index + 1 }));
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
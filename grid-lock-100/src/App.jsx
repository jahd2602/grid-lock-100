import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  onSnapshot,
  updateDoc,
  getDocs,
  query,
  where,
  limit,
  serverTimestamp
} from 'firebase/firestore';
import {
  Users,
  Target,
  Zap,
  Rocket
} from 'lucide-react';
import ActiveGame from './components/ActiveGame';

// --- Firebase Config & Init ---
const firebaseConfig = {
  apiKey: "AIzaSyC7Gm_3Lie_unVXaw6s7wVp2urxt7RAyJ0",
  authDomain: "gridlock100.firebaseapp.com",
  projectId: "gridlock100",
  storageBucket: "gridlock100.firebasestorage.app",
  messagingSenderId: "295310640766",
  appId: "1:295310640766:web:f1b85dd7a46b28e3d27a2f",
  measurementId: "G-JVY8NNNLHQ"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'grid-lock-100-dev';

// --- Game Constants ---
export const GRID_SIZE = 8;
export const WINNING_SCORE = 100;

// Tetromino-ish Shapes
const SHAPES = [
  { id: '1x1', shape: [[1]] },
  { id: '2x1', shape: [[1, 1]] },
  { id: '1x2', shape: [[1], [1]] },
  { id: '3x1', shape: [[1, 1, 1]] },
  { id: '1x3', shape: [[1], [1], [1]] },
  { id: '2x2', shape: [[1, 1], [1, 1]] },
  { id: 'L', shape: [[1, 0], [1, 0], [1, 1]] },
  { id: 'T', shape: [[1, 1, 1], [0, 1, 0]] },
  { id: 'Z', shape: [[1, 1, 0], [0, 1, 1]] }
];

// --- Helper Functions ---
export const createEmptyGrid = () => Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0));

export const generatePieces = (count = 3) => {
  return Array(count).fill(null).map((_, i) => ({
    uid: Math.random().toString(36).substr(2, 9),
    ...SHAPES[Math.floor(Math.random() * SHAPES.length)]
  }));
};

// Firestore doesn't support nested arrays, so we strip the 'shape' matrix
// and just store the 'id' (e.g. 'L', 'T') + instance 'uid'.
export const serializePieces = (pieces) => {
  if (!pieces) return [];
  return pieces.map(p => p ? { uid: p.uid, id: p.id } : null);
};

// Reconstruct the full piece object with 'shape' matrix from the ID.
export const hydratePieces = (pieces) => {
  if (!pieces) return [];
  return pieces.map(p => {
    if (!p) return null;
    const shapeObj = SHAPES.find(s => s.id === p.id);
    return { ...p, shape: shapeObj ? shapeObj.shape : [[1]] };
  });
};

export const gridToString = (grid) => grid.flat().join('');
export const stringToGrid = (str) => {
  const grid = createEmptyGrid();
  if (!str) return grid;
  for (let i = 0; i < 64; i++) {
    const row = Math.floor(i / GRID_SIZE);
    const col = i % GRID_SIZE;
    grid[row][col] = parseInt(str[i] || '0');
  }
  return grid;
};

export default function App() {
  const [user, setUser] = useState(null);
  const [matchId, setMatchId] = useState(null);
  const [playerRole, setPlayerRole] = useState(null); // 'p1' or 'p2'
  const [gameState, setGameState] = useState(null); // The full game state object
  const [gameStatus, setGameStatus] = useState('menu'); // menu, finding, playing, finished
  const [isSolo, setIsSolo] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFindingHint, setShowFindingHint] = useState(false);

  // --- Matchmaking Hint Timer ---
  useEffect(() => {
    let timer;
    if (gameStatus === 'finding') {
      timer = setTimeout(() => {
        setShowFindingHint(true);
      }, 3000);
    } else {
      setShowFindingHint(false);
    }
    return () => clearTimeout(timer);
  }, [gameStatus]);

  const cancelFinding = () => {
    setGameStatus('menu');
    setMatchId(null);
    setGameState(null);
  };

  // --- Auth & Init ---
  useEffect(() => {
    const initAuth = async () => {
      // Simple anonymous sign-in for localhost
      await signInAnonymously(auth);
    };
    initAuth();
    return onAuthStateChanged(auth, setUser);
  }, []);

  // --- Solo Mode Logic ---
  const startSolo = () => {
    // Attempt fullscreen
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { });
      setIsFullscreen(true);
    }

    setIsSolo(true);
    const initialGrid = gridToString(createEmptyGrid());
    const initialState = {
      p1: {
        uid: user?.uid || 'solo',
        gridStr: initialGrid,
        score: 0,
        pieces: generatePieces(3),
        attackIncoming: null,
        lockedUntil: 0,
        lastSeen: Date.now()
      },
      p2: {
        uid: 'bot',
        gridStr: initialGrid,
        score: 0,
        pieces: [], // Spectator empty for bot
        attackIncoming: null,
        lockedUntil: 0,
        lastSeen: Date.now()
      },
      winner: null,
      status: 'playing',
      createdAt: Date.now()
    };
    setGameState(initialState);
    setPlayerRole('p1');
    setGameStatus('playing');
  };

  // --- Matchmaking (Multiplayer) ---
  const findMatch = async () => {
    console.log("findMatch: Starting matchmaking found...");
    if (!user) {
      console.log("findMatch: No user found, aborting.");
      return;
    }

    // Attempt fullscreen
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { });
      setIsFullscreen(true);
    }

    setIsSolo(false);
    setGameStatus('finding');
    console.log("findMatch: Status set to finding. UserId:", user.uid);

    try {
      const matchesRef = collection(db, 'artifacts', appId, 'public', 'data', 'matches');
      console.log("findMatch: Querying for waiting matches in", matchesRef.path);

      // 1. Try to join an existing waiting match
      const q = query(matchesRef, where('status', '==', 'waiting'), limit(1));
      const querySnapshot = await getDocs(q);
      console.log("findMatch: Query Snapshot size:", querySnapshot.size);

      if (!querySnapshot.empty) {
        const matchDoc = querySnapshot.docs[0];
        const matchData = matchDoc.data();
        console.log("findMatch: Found waiting match:", matchDoc.id, matchData);

        // Prevent joining own match if revisited
        if (matchData.p1.uid === user.uid) {
          console.log("findMatch: User is already P1 in this match. Rejoining as P1.");
          setMatchId(matchDoc.id);
          setPlayerRole('p1');
          return;
        }

        console.log("findMatch: Joining as P2...");
        await updateDoc(doc(matchesRef, matchDoc.id), {
          'p2.uid': user.uid,
          status: 'playing',
          startTime: serverTimestamp()
        });
        console.log("findMatch: Joined successfully.");

        setMatchId(matchDoc.id);
        setPlayerRole('p2');
      } else {
        // 2. Create new match
        console.log("findMatch: No waiting matches found. Creating new match...");
        const newMatchRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'matches'));

        // Serialize pieces before saving to avoid nested array error
        const p1Pieces = serializePieces(generatePieces(3));
        const p2Pieces = serializePieces(generatePieces(3));

        const newMatchData = {
          p1: {
            uid: user.uid,
            gridStr: gridToString(createEmptyGrid()),
            score: 0,
            pieces: p1Pieces,
            attackIncoming: null,
            lockedUntil: 0,
            lastSeen: serverTimestamp()
          },
          p2: {
            uid: null,
            gridStr: gridToString(createEmptyGrid()),
            score: 0,
            pieces: p2Pieces,
            attackIncoming: null,
            lockedUntil: 0,
            lastSeen: serverTimestamp()
          },
          winner: null,
          status: 'waiting',
          createdAt: serverTimestamp()
        };

        await setDoc(newMatchRef, newMatchData);
        console.log("findMatch: Created new match:", newMatchRef.id);

        setMatchId(newMatchRef.id);
        setPlayerRole('p1');
      }
    } catch (e) {
      console.error("Matchmaking error:", e);
      setGameStatus('menu');
    }
  };

  // --- Debug: Reset Identity ---
  const resetIdentity = async () => {
    await signOut(auth);
    await signInAnonymously(auth);
    window.location.reload();
  };

  // --- Fullscreen Toggle ---
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(err => console.error(err));
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(err => console.error(err));
    }
  };

  // --- Unified Update Handler ---
  // Handles both Firestore updates (Multiplayer) and local State updates (Solo)
  const handleGameUpdate = async (updates) => {
    if (isSolo) {
      setGameState(prev => {
        const newState = JSON.parse(JSON.stringify(prev)); // Deep clone simple object

        Object.keys(updates).forEach(key => {
          const parts = key.split('.');
          if (parts.length === 1) {
            newState[key] = updates[key];
          } else if (parts.length === 2) {
            newState[parts[0]][parts[1]] = updates[key];
          }
        });

        return newState;
      });
    } else {
      if (!matchId) return;
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'matches', matchId), updates);
    }
  };

  // --- Game Loop Sync (Multiplayer Only) ---
  useEffect(() => {
    if (isSolo || !matchId || !user) return;

    const unsub = onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'matches', matchId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        // console.log(`[Sync] Match ${matchId} updated. Status: ${data.status}`);

        // Hydrate pieces (restore shape matrix) from Firestore data
        if (data.p1?.pieces) data.p1.pieces = hydratePieces(data.p1.pieces);
        if (data.p2?.pieces) data.p2.pieces = hydratePieces(data.p2.pieces);

        setGameState(data);
        if (data.status === 'playing' && gameStatus !== 'playing') setGameStatus('playing');
        if (data.status === 'finished') setGameStatus('finished');
      }
    }, (err) => console.error("Sync error", err));

    return () => unsub();
  }, [matchId, user, gameStatus, isSolo]);

  if (!user) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Authenticating...</div>;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500 selection:text-white overflow-hidden touch-none"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >

      {/* Menu Screen */}
      {gameStatus === 'menu' && (
        <div className="flex flex-col items-center justify-center h-screen p-6 space-y-8 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black">
          <div className="text-center space-y-2">
            <h1 className="text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-cyan-400 to-blue-600">
              GRID LOCK
            </h1>
            <p className="text-xl text-slate-400 font-mono tracking-widest">100 BLOCK RACE</p>
          </div>

          <div className="grid grid-cols-2 gap-4 max-w-md w-full">
            <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 backdrop-blur-sm">
              <Zap className="w-6 h-6 text-yellow-400 mb-2" />
              <h3 className="font-bold">Speed</h3>
              <p className="text-xs text-slate-400">Clear lines fast to score points.</p>
            </div>
            <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 backdrop-blur-sm">
              <Rocket className="w-6 h-6 text-red-400 mb-2" />
              <h3 className="font-bold">Attack</h3>
              <p className="text-xs text-slate-400">Clear 3+ lines to lock opponent's pieces.</p>
            </div>
          </div>

          <div className="flex flex-col gap-4 w-full max-w-xs">
            <button
              onClick={findMatch}
              className="group relative px-8 py-4 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xl rounded-full transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(6,182,212,0.5)] w-full"
            >
              <span className="flex items-center justify-center gap-2">
                <Users className="w-6 h-6 fill-current" />
                MULTIPLAYER
              </span>
            </button>

            <button
              onClick={startSolo}
              className="group px-8 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-lg rounded-full transition-all hover:scale-105 active:scale-95 border border-slate-700 w-full"
            >
              <span className="flex items-center justify-center gap-2">
                <Target className="w-5 h-5 text-emerald-400" />
                SOLO TRAINING
              </span>
            </button>

            {/* <button
              onClick={resetIdentity}
              className="mt-4 text-xs text-slate-600 hover:text-slate-400 underline"
            >
              DEBUG: New Player ID
            </button> */}
          </div>
        </div>
      )}

      {/* Waiting Screen */}
      {gameStatus === 'finding' && (
        <div className="flex flex-col items-center justify-center h-screen space-y-6 p-6">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin"></div>
            <Users className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 text-cyan-500" />
          </div>
          <div className="text-center space-y-2">
            <p className="text-slate-400 animate-pulse">Scanning network for opponent...</p>
            {showFindingHint && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-1000">
                <p className="text-cyan-500/80 text-sm font-medium">
                  HINT: Ask a friend to open this game on their device and click Multiplayer too!
                </p>
                <button
                  onClick={cancelFinding}
                  className="mt-6 px-6 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-full text-xs font-bold transition-all border border-slate-700"
                >
                  CANCEL SEARCH
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Game Screen */}
      {(gameStatus === 'playing' || gameStatus === 'finished') && gameState && (
        <ActiveGame
          matchId={matchId}
          playerRole={playerRole}
          gameState={gameState}
          userId={user.uid}
          onGameUpdate={handleGameUpdate}
          isSolo={isSolo}
          toggleFullscreen={toggleFullscreen}
          isFullscreen={isFullscreen}
        />
      )}
    </div>
  );
}


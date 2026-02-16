import React, { useState, useEffect, useRef } from 'react';
import { serverTimestamp } from 'firebase/firestore';
import {
    Trophy,
    Zap,
    ShieldAlert,
    Lock,
    RotateCcw,
    Target,
    WifiOff,
    SignalLow,
    Maximize,
    Minimize
} from 'lucide-react';

// Import shared helpers and constants from App
import {
    GRID_SIZE,
    WINNING_SCORE,
    createEmptyGrid,
    generatePieces,
    serializePieces,
    gridToString,
    stringToGrid
} from '../App';

export default function ActiveGame({ matchId, playerRole, gameState, userId, onGameUpdate, isSolo, toggleFullscreen, isFullscreen }) {
    const opponentRole = playerRole === 'p1' ? 'p2' : 'p1';
    const myData = gameState[playerRole];
    const oppData = gameState[opponentRole];

    // Local state for smooth interaction
    const [localGrid, setLocalGrid] = useState(stringToGrid(myData.gridStr));
    const [localPieces, setLocalPieces] = useState(myData.pieces);
    const [dragPiece, setDragPiece] = useState(null); // { piece, x, y, startX, startY }
    const [ghostPos, setGhostPos] = useState(null);
    const [lockedSlots, setLockedSlots] = useState([]); // Indices of locked tray slots
    const [frozen, setFrozen] = useState(false);
    const [flash, setFlash] = useState(false);
    const [clearingCells, setClearingCells] = useState(new Set()); // Set of "r-c" strings
    const [scoreParticles, setScoreParticles] = useState([]); // Array of {id, x, y, value}
    const [connectionIssue, setConnectionIssue] = useState(false);

    const gridRef = useRef(null);

    // --- Heartbeat & Offline Detection ---
    useEffect(() => {
        if (isSolo || gameState.status !== 'playing') return;

        // 1. Send Heartbeat
        const heartbeatInterval = setInterval(() => {
            onGameUpdate({
                [`${playerRole}.lastSeen`]: serverTimestamp()
            });
        }, 1000); // Send every 1s

        // 2. Check Opponent Status
        const checkInterval = setInterval(() => {
            if (gameState.winner) return; // Don't check if game over

            const opponentLastSeen = oppData.lastSeen;
            if (!opponentLastSeen) return;

            // Firestore timestamp to millis
            const lastSeenMillis = opponentLastSeen.toMillis ? opponentLastSeen.toMillis() : opponentLastSeen;
            const timeSince = Date.now() - lastSeenMillis;

            // Connection Issue Warning (> 5s)
            if (timeSince > 5000) {
                setConnectionIssue(true);
            } else {
                setConnectionIssue(false);
            }

            // Disconnect (> 10s)
            if (timeSince > 10000) {
                // Declare victory if I am still connected
                console.log("Opponent timed out! Claiming victory.");
                onGameUpdate({
                    status: 'finished',
                    winner: userId
                });
            }
        }, 500); // Check faster (every 500ms) for responsiveness

        return () => {
            clearInterval(heartbeatInterval);
            clearInterval(checkInterval);
        };
    }, [isSolo, gameState.status, gameState.winner, oppData.lastSeen, playerRole]);

    // Sync incoming attacks (Locks)
    useEffect(() => {
        if (myData.attackIncoming) {
            // Opponent sent an attack
            if (myData.attackIncoming.type === 'lock') {
                const slot = Math.floor(Math.random() * 3);
                setLockedSlots(prev => [...prev, slot]);
                setFlash(true);
                setTimeout(() => setFlash(false), 500);

                // Remove lock after duration
                setTimeout(() => {
                    setLockedSlots(prev => prev.filter(s => s !== slot));
                }, myData.attackIncoming.duration);
            }

            // Clear the attack flag
            onGameUpdate({
                [`${playerRole}.attackIncoming`]: null
            });
        }
    }, [myData.attackIncoming, playerRole]);

    // Handle Penalty Freeze
    useEffect(() => {
        const isFrozen = myData.lockedUntil > Date.now();
        setFrozen(isFrozen);
        if (isFrozen) {
            const timeLeft = myData.lockedUntil - Date.now();
            setTimeout(() => setFrozen(false), timeLeft);
        }
    }, [myData.lockedUntil]);

    // --- Interaction Logic ---

    const handleDragStart = (e, piece, index) => {
        if (frozen || lockedSlots.includes(index) || clearingCells.size > 0) return;

        // Support mouse or touch
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        setDragPiece({
            piece,
            index,
            currentX: clientX,
            currentY: clientY,
            offsetX: 0,
            offsetY: 0 // Will need offset logic for perfect centering, simplified here
        });
    };

    const handleDragMove = (e) => {
        if (!dragPiece) return;
        e.preventDefault(); // Prevent scroll on touch

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        // Calculate grid position
        let ghost = null;
        if (gridRef.current) {
            const rect = gridRef.current.getBoundingClientRect();
            const cellSize = rect.width / GRID_SIZE;

            // Relative to grid
            const relX = clientX - rect.left;
            const relY = clientY - rect.top;

            // Convert to grid coords
            const pieceW = dragPiece.piece.shape[0].length * cellSize;
            const pieceH = dragPiece.piece.shape.length * cellSize;

            const gridX = Math.floor((relX - pieceW / 2 + cellSize / 2) / cellSize);
            const gridY = Math.floor((relY - pieceH / 2 + cellSize / 2) / cellSize);

            if (canPlace(dragPiece.piece.shape, gridX, gridY, localGrid)) {
                ghost = { x: gridX, y: gridY };
            }
        }

        setDragPiece(prev => ({ ...prev, currentX: clientX, currentY: clientY }));
        setGhostPos(ghost);
    };

    const handleDragEnd = async () => {
        if (!dragPiece) return;

        if (ghostPos) {
            // Valid placement
            // We pass the current drag position to spawn the score particle at the right spot
            placePiece(dragPiece.piece, ghostPos.x, ghostPos.y, dragPiece.index, dragPiece.currentX, dragPiece.currentY);
        }

        setDragPiece(null);
        setGhostPos(null);
    };

    // --- Game Rules ---

    const canPlace = (shape, x, y, grid) => {
        for (let r = 0; r < shape.length; r++) {
            for (let c = 0; c < shape[r].length; c++) {
                if (shape[r][c] === 1) {
                    const newY = y + r;
                    const newX = x + c;
                    if (newY < 0 || newY >= GRID_SIZE || newX < 0 || newX >= GRID_SIZE || grid[newY][newX] === 1) {
                        return false;
                    }
                }
            }
        }
        return true;
    };

    const placePiece = async (piece, x, y, pieceIndex, dropX, dropY) => {
        // 1. Place the piece locally (Temporary state before clear)
        const newGrid = localGrid.map(row => [...row]);
        piece.shape.forEach((row, r) => {
            row.forEach((cell, c) => {
                if (cell === 1) newGrid[y + r][x + c] = 1;
            });
        });

        // Update pieces immediately (remove from tray)
        const newPieces = [...localPieces];
        newPieces[pieceIndex] = null;
        setLocalPieces(newPieces);

        // Update grid immediately so user sees the piece land
        setLocalGrid(newGrid);

        // 2. Identify Clears
        const rowsToClear = new Set();
        const colsToClear = new Set();

        // Check Rows
        for (let r = 0; r < GRID_SIZE; r++) {
            if (newGrid[r].every(val => val === 1)) rowsToClear.add(r);
        }
        // Check Cols
        for (let c = 0; c < GRID_SIZE; c++) {
            let full = true;
            for (let r = 0; r < GRID_SIZE; r++) {
                if (newGrid[r][c] === 0) full = false;
            }
            if (full) colsToClear.add(c);
        }

        const hasClears = rowsToClear.size > 0 || colsToClear.size > 0;
        const piecePoints = piece.shape.flat().filter(x => x).length;

        if (hasClears) {
            // TRIGGER ANIMATION

            // Identify specific cells to animate
            const cellsToAnimate = new Set();
            for (let r = 0; r < GRID_SIZE; r++) {
                for (let c = 0; c < GRID_SIZE; c++) {
                    if (rowsToClear.has(r) || colsToClear.has(c)) {
                        cellsToAnimate.add(`${r}-${c}`);
                    }
                }
            }
            setClearingCells(cellsToAnimate);

            // Calculate clear points
            const totalCleared = (rowsToClear.size * GRID_SIZE) + (colsToClear.size * GRID_SIZE) - (rowsToClear.size * colsToClear.size);
            const totalPoints = totalCleared; // + piece points usually counted in clear, but standard is just cells cleared

            // Spawn Particle
            setScoreParticles(prev => [...prev, {
                id: Date.now(),
                x: dropX,
                y: dropY,
                value: totalPoints
            }]);

            // Remove particle after animation
            setTimeout(() => {
                setScoreParticles(prev => prev.filter(p => Date.now() - p.id < 1000));
            }, 1100);

            // Wait 1 second (animation duration) then finalize the grid change
            setTimeout(() => {
                finalizeTurn(newGrid, newPieces, rowsToClear, colsToClear, piecePoints);
                setClearingCells(new Set());
            }, 1000);

        } else {
            // No clears, finalize immediately
            finalizeTurn(newGrid, newPieces, new Set(), new Set(), piecePoints);
        }
    };

    const finalizeTurn = (currentGrid, currentPieces, rowsToClear, colsToClear, points) => {
        // 1. Calculate Final Grid (remove lines)
        const finalGrid = createEmptyGrid();
        for (let r = 0; r < GRID_SIZE; r++) {
            for (let c = 0; c < GRID_SIZE; c++) {
                if (rowsToClear.has(r) || colsToClear.has(c)) {
                    finalGrid[r][c] = 0;
                } else {
                    finalGrid[r][c] = currentGrid[r][c];
                }
            }
        }

        // Clear Points + Piece Points
        // If we cleared lines, points arg might be just piece points or we add clear bonus.
        // Let's use standard: points arg passed in. 
        // If lines cleared, we use calculated totalCleared from placePiece logic?
        // Let's recalculate simply here to be safe or pass it down.
        // Simplified: 1 block = 1 point.

        // If lines cleared, the points were visualized in particle. We need to add them to score.
        // We can recalculate cleared count here.
        const cellsClearedCount = (rowsToClear.size * GRID_SIZE) + (colsToClear.size * GRID_SIZE) - (rowsToClear.size * colsToClear.size);

        // MODIFIED: Only add score if lines are cleared. Placed blocks (points arg) are ignored if no clear occurs.
        const scoreToAdd = cellsClearedCount > 0 ? cellsClearedCount : 0;

        const linesCount = rowsToClear.size + colsToClear.size;

        // Refill logic
        const nextPieces = [...currentPieces];
        if (nextPieces.every(p => p === null)) {
            const fresh = generatePieces(3);
            fresh.forEach((p, i) => nextPieces[i] = p);
        }

        setLocalGrid(finalGrid);
        setLocalPieces(nextPieces);

        // Check Defeat (Board Wipe)
        const availablePieces = nextPieces.filter(p => p !== null);
        let canMove = false;

        if (availablePieces.length === 0) {
            canMove = true;
        } else {
            checkLoop: for (let p of availablePieces) {
                for (let r = 0; r < GRID_SIZE; r++) {
                    for (let c = 0; c < GRID_SIZE; c++) {
                        if (canPlace(p.shape, r, c, finalGrid)) {
                            canMove = true;
                            break checkLoop;
                        }
                    }
                }
            }
        }

        // Construct Update Payload
        // CRITICAL FIX: If multiplayer, serialize pieces (remove nested array) before sending to Firestore
        const piecesToSave = isSolo ? nextPieces : serializePieces(nextPieces);

        const updates = {
            [`${playerRole}.gridStr`]: gridToString(finalGrid),
            [`${playerRole}.pieces`]: piecesToSave,
            [`${playerRole}.score`]: myData.score + scoreToAdd,
        };

        if (myData.score + scoreToAdd >= WINNING_SCORE) {
            updates['status'] = 'finished';
            updates['winner'] = userId;
        }

        if (linesCount >= 3 && !isSolo) {
            updates[`${playerRole === 'p1' ? 'p2' : 'p1'}.attackIncoming`] = {
                type: 'lock',
                duration: 7000,
                timestamp: Date.now()
            };
        }

        if (!canMove) {
            setFlash(true);
            setTimeout(() => setFlash(false), 800);
            updates[`${playerRole}.gridStr`] = gridToString(createEmptyGrid());
            updates[`${playerRole}.score`] = Math.max(0, myData.score + scoreToAdd - 10);
            updates[`${playerRole}.lockedUntil`] = Date.now() + 3000;
            setLocalGrid(createEmptyGrid());
        }

        onGameUpdate(updates);
    };

    // --- Render Helpers ---
    const getCellColor = (val, r, c, isGhost) => {
        // Check if cell is currently animating out
        const isClearing = clearingCells.has(`${r}-${c}`);
        if (isClearing) return 'bg-white z-20 animate-clearing shadow-[0_0_15px_white] border-2 border-white';

        if (val === 0) {
            if (isGhost) return 'bg-white/10 border-2 border-white/40 border-dashed animate-pulse';
            return 'bg-slate-800/50 border-2 border-transparent';
        }

        if (isGhost) return 'bg-cyan-500/30 border-2 border-cyan-500/50';

        // Player filled
        return playerRole === 'p1'
            ? 'bg-cyan-500 border-2 border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.5)]'
            : 'bg-fuchsia-500 border-2 border-fuchsia-400 shadow-[0_0_10px_rgba(217,70,239,0.5)]';
    };

    return (
        <div
            className="h-screen w-full flex flex-col relative overflow-hidden"
            onMouseMove={handleDragMove}
            onTouchMove={handleDragMove}
            onMouseUp={handleDragEnd}
            onTouchEnd={handleDragEnd}
        >
            {flash && <div className="absolute inset-0 bg-red-500/20 z-50 pointer-events-none animate-pulse" />}

            {/* Floating Score Particles */}
            {scoreParticles.map(p => (
                <div
                    key={p.id}
                    className="fixed z-[100] text-4xl font-black text-yellow-400 animate-float-score pointer-events-none drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)]"
                    style={{ left: p.x, top: p.y }}
                >
                    +{p.value}
                </div>
            ))}

            {/* --- HUD --- */}
            <div className="flex-none flex items-end justify-between p-2 md:p-4 bg-slate-900 border-b border-slate-800 z-10 shrink-0">

                <div className="flex flex-col gap-1 w-1/3">
                    <div className="flex justify-between text-[10px] md:text-xs font-mono text-cyan-400">
                        <span>{isSolo ? 'SCORE' : 'YOU'}</span>
                        <span>{Math.floor(myData.score)}/{WINNING_SCORE}</span>
                    </div>
                    <div className="h-1.5 md:h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-cyan-500 transition-all duration-500" style={{ width: `${(myData.score / WINNING_SCORE) * 100}%` }}></div>
                    </div>
                </div>

                <div className="flex flex-col items-center">
                    <div className="bg-slate-800 px-2 py-0.5 md:px-3 md:py-1 rounded text-[10px] md:text-xs font-mono text-slate-400 border border-slate-700">
                        🎯: 100
                    </div>
                </div>

                <div className="flex flex-col gap-1 w-1/3 text-right">
                    {isSolo ? (
                        <div className="flex justify-end items-center gap-2 text-slate-500 text-[10px] md:text-xs font-mono h-full">
                            <Target className="w-3 h-3 md:w-4 md:h-4" /> SOLO MODE
                        </div>
                    ) : (
                        <>
                            <div className="flex justify-between text-[10px] md:text-xs font-mono text-fuchsia-400">
                                <span>OPPONENT</span>
                                <span>{Math.floor(oppData.score)}/{WINNING_SCORE}</span>
                            </div>
                            <div className="h-1.5 md:h-2 bg-slate-800 rounded-full overflow-hidden">
                                <div className="h-full bg-fuchsia-500 transition-all duration-500" style={{ width: `${(oppData.score / WINNING_SCORE) * 100}%` }}></div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* --- Spectator Zone & Controls (Top) --- */}
            <div className="flex-none p-2 md:p-4 flex justify-between items-start relative shrink-0">

                {/* Fullscreen config (Left aligned in this row) */}
                <div>
                    <button onClick={toggleFullscreen} className="text-slate-500 hover:text-cyan-400 p-2 bg-slate-900/50 rounded-lg border border-slate-700/50 backdrop-blur-sm transition-colors">
                        {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                    </button>
                </div>

                {!isSolo && (
                    <div className="bg-slate-900 p-1 md:p-2 rounded-lg border border-slate-700 shadow-xl opacity-80 relative">

                        {/* Connection Issue Overlay */}
                        {connectionIssue && (
                            <div className="absolute inset-0 z-20 bg-slate-950/80 flex flex-col items-center justify-center rounded-lg animate-pulse backdrop-blur-sm">
                                <SignalLow className="w-6 h-6 text-yellow-500 mb-1" />
                                <span className="text-[9px] text-yellow-500 font-bold uppercase tracking-wider">Reconnecting</span>
                            </div>
                        )}

                        <div className="grid grid-cols-8 gap-[1px] bg-slate-800 border border-slate-800 mb-1 md:mb-2 w-[80px] h-[80px] md:w-[100px] md:h-[100px]">
                            {stringToGrid(oppData.gridStr).map((row, r) => (
                                row.map((cell, c) => (
                                    <div key={`${r}-${c}`} className={`w-full h-full ${cell ? 'bg-fuchsia-500/80' : 'bg-slate-900'}`} />
                                ))
                            ))}
                        </div>
                        {/* Opponent Tray Mini */}
                        <div className="flex justify-center gap-1 h-5 md:h-6">
                            {oppData.pieces.map((p, i) => (
                                <div key={i} className="w-5 md:w-6 bg-slate-800/50 rounded flex items-center justify-center">
                                    {p && <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-fuchsia-500/50 rounded-sm" />}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* --- Main Player Zone (Center/Bottom) --- */}
            <div className={`flex-1 flex flex-col items-center justify-start md:justify-center gap-2 md:gap-6 relative overflow-y-auto pb-safe ${isSolo ? 'pt-4 md:pt-8' : ''}`}>
                {/* Game Over Overlay */}
                {gameState.winner && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur">
                        <div className="text-center p-8 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl transform scale-110">
                            {gameState.winner === userId || isSolo ? (
                                <>
                                    <Trophy className="w-16 h-16 text-yellow-400 mx-auto mb-4 animate-bounce" />
                                    <h2 className="text-4xl font-black text-white mb-2">VICTORY</h2>
                                    <p className="text-cyan-400">
                                        {isSolo ? 'Target Reached!' : (
                                            gameState.status === 'finished' && gameState.winner === userId
                                                ? 'You Won!'
                                                : 'Target Reached!'
                                        )}
                                    </p>
                                </>
                            ) : (
                                <>
                                    <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" />
                                    <h2 className="text-4xl font-black text-white mb-2">DEFEAT</h2>
                                    <p className="text-slate-400">Opponent claimed the grid.</p>
                                </>
                            )}

                            {!isSolo && gameState.winner === userId && (
                                <div className="mt-2 text-xs text-slate-500 flex items-center justify-center gap-1">
                                    <WifiOff className="w-3 h-3" />
                                    If opponent disconnects (&gt;10s), you win automatically.
                                </div>
                            )}
                            <button
                                onClick={() => window.location.reload()}
                                className="mt-8 px-6 py-2 bg-white text-black font-bold rounded-full hover:bg-slate-200"
                            >
                                Play Again
                            </button>
                        </div>
                    </div>
                )}

                {/* Board */}
                <div
                    ref={gridRef}
                    className={`relative bg-slate-900 p-2 rounded-xl border border-slate-700 shadow-2xl transition-all duration-300 ${frozen ? 'grayscale brightness-50 pointer-events-none' : ''}`}
                >
                    {frozen && (
                        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-red-500 font-bold animate-pulse">
                            <RotateCcw className="w-12 h-12 mb-2 animate-spin" />
                            <span className="text-2xl">BOARD WIPE</span>
                            <span className="text-xs text-white">NO MOVES POSSIBLE (-10 PTS)</span>
                        </div>
                    )}

                    <div className="grid grid-cols-8 gap-1 w-[300px] h-[300px] sm:w-[360px] sm:h-[360px]">
                        {localGrid.map((row, r) => (
                            row.map((cell, c) => {
                                const isGhost = ghostPos && ghostPos.y <= r && r < ghostPos.y + dragPiece.piece.shape.length &&
                                    ghostPos.x <= c && c < ghostPos.x + dragPiece.piece.shape[0].length &&
                                    dragPiece.piece.shape[r - ghostPos.y][c - ghostPos.x] === 1;

                                return (
                                    <div
                                        key={`${r}-${c}`}
                                        className={`w-full h-full rounded-sm transition-colors duration-100 ${getCellColor(cell, r, c, isGhost)}`}
                                    />
                                );
                            })
                        ))}
                    </div>
                </div>

                {/* Tray */}
                <div className="w-full max-w-md px-4 pb-8 flex justify-center gap-4 h-24">
                    {localPieces.map((piece, i) => {
                        const isLocked = lockedSlots.includes(i);
                        const isDragging = dragPiece && dragPiece.index === i;

                        return (
                            <div
                                key={i}
                                className={`flex-1 h-24 bg-slate-800/50 rounded-lg border-2 border-slate-800 flex items-center justify-center relative ${isLocked ? 'border-red-500/50 bg-red-900/10' : ''}`}
                                onMouseDown={(e) => piece && !isLocked && handleDragStart(e, piece, i)}
                                onTouchStart={(e) => piece && !isLocked && handleDragStart(e, piece, i)}
                            >
                                {isLocked && <Lock className="w-8 h-8 text-red-500 absolute z-20 animate-lock" />}

                                {piece && !isDragging && (
                                    <div className={`grid gap-[2px] pointer-events-none opacity-${isLocked ? '20' : '100'}`} style={{
                                        gridTemplateColumns: `repeat(${piece.shape[0].length}, 1fr)`
                                    }}>
                                        {piece.shape.map((row, r) => (
                                            row.map((cell, c) => (
                                                cell ? <div key={`${r}-${c}`} className="w-4 h-4 bg-cyan-500 rounded-sm shadow-sm" /> : <div key={`${r}-${c}`} />
                                            ))
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Draggable Follower */}
            {dragPiece && (
                <div
                    className="fixed pointer-events-none z-50 opacity-80"
                    style={{
                        left: dragPiece.currentX,
                        top: dragPiece.currentY,
                        transform: 'translate(-50%, -50%) scale(1.1)'
                    }}
                >
                    <div className="grid gap-1" style={{
                        gridTemplateColumns: `repeat(${dragPiece.piece.shape[0].length}, 1fr)`
                    }}>
                        {dragPiece.piece.shape.map((row, r) => (
                            row.map((cell, c) => (
                                cell ? <div key={`${r}-${c}`} className="w-8 h-8 bg-cyan-400 rounded-sm shadow-[0_0_15px_rgba(34,211,238,0.8)]" /> : <div key={`${r}-${c}`} />
                            ))
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

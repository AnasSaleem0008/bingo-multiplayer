# Bingo Multiplayer

Node.js + Express + Socket.IO multiplayer Bingo.

## Features
- 2–10 players
- Unique 10x10 boards
- Turn-based number calling
- **30-second server-controlled turn timer** with automatic number selection
- Live player scores
- Leave Game support; departed players are removed from the active player list
- Previous marked-number state is preserved internally for departed players
- Game ends immediately when fewer than 2 active players remain
- Host transfers to another active player when the host leaves
- Live room chat with emoji shortcuts
- Responsive mobile-friendly UI

## Run locally

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

The server uses the `PORT` environment variable when supplied (for example by a hosting provider), otherwise it uses port `3000`.

## Important deployment note

This project uses a persistent Socket.IO server. A normal Vercel deployment can serve the frontend files, but **Vercel Functions are not a replacement for a persistent Socket.IO/WebSocket server**. Therefore the complete multiplayer game cannot run from Vercel alone.

For a real online deployment, host `server.js` on a platform that supports a long-running Node.js process/WebSockets and point the browser client to that server. For the offline hotspot version, the same Node/Socket.IO architecture can later be adapted to run locally on the host device.

## GitHub

Upload the project files (including `package-lock.json`) to a GitHub repository. Do not upload `node_modules`; run `npm install` after cloning.


## Current version notes

- Turn timer is controlled by the server and is 30 seconds.
- Chat supports text and emoji through Socket.IO.
- A player who uses Leave Game is removed from the active player list and turn rotation.
- A departed player's stored board/marks remain archived in the room and are not reactivated by Play Again.
- This project requires a persistent Node.js + Socket.IO server. Static-only hosting such as a Vercel frontend does not provide the Socket.IO server by itself.

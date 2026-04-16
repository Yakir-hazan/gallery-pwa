# Gallery PWA

A Progressive Web App for backing up images from mobile devices to a server.

## Stack

- **Backend**: Node.js + Express, Multer (file uploads), JWT auth, dotenv
- **Frontend**: Vanilla JS, HTML, CSS (dark mode PWA)
- **Storage**: Local filesystem (`/uploads`); optional Cloudinary integration
- **Runtime**: Node.js 20

## Running the App

```bash
npm start
```

Server runs on port 5000 (configured via `PORT=5000` in the workflow).

## Key Files

- `server.js` — Express backend (auth, upload, file listing, deletion)
- `app.js` — Frontend logic (upload queue, compression, PWA)
- `index.html` — Main UI
- `sw.js` — Service Worker (caching, background sync)
- `styles.css` — Dark-mode styles
- `manifest.json` — PWA config

## Notes

- **GitHub integration**: The user dismissed the Replit GitHub OAuth connector. To connect to GitHub in the future, either re-propose the OAuth integration or ask the user for a GitHub Personal Access Token (with `repo` scope) to store as a secret (`GITHUB_TOKEN`).

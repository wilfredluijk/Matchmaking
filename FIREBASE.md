# Deployment

This repo ships **two** variants of the same Smash tournament app:

| Variant | Location | Persistence | Auth | Where to host |
|---|---|---|---|---|
| **Static** | `/index.html`, `/app.js` | `localStorage` (per browser) | none | GitHub Pages, any static host, or `file://` |
| **Live** | `/live/index.html`, `/live/app.js` | Firestore (shared, realtime) | Firebase Auth (admin only) | Firebase Hosting |

Both share `styles.css` at the root, so they look identical.

## Live variant — quick start

### 1. Create a Firebase project

1. Go to https://console.firebase.google.com → **Add project**.
2. In the project, open **Build → Authentication → Get started**, enable **Email/Password**, and **disable** the "Allow new users to sign up" toggle in *Settings → User actions* (so only accounts you create can write).
3. Open **Authentication → Users → Add user** and create the admin account (email + password).
4. Open **Build → Firestore Database → Create database** in production mode (region of your choice).

### 2. Get your web config

Project Settings → *Your apps* → **Web app** (`</>`). Register an app, copy the `firebaseConfig` object.

Open `live/firebase-config.js` and paste your values:

```js
export const firebaseConfig = {
  apiKey: "AIza…",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "…",
  appId: "1:…:web:…",
};
```

These keys are public-safe — Firestore security comes from `firestore.rules` (public read, authenticated write).

### 3. Deploy

Install the Firebase CLI once:

```bash
npm install -g firebase-tools
firebase login
```

From the repo root:

```bash
firebase use --add        # pick your project, alias as default
firebase deploy           # deploys hosting + Firestore rules
```

After deploy you'll get a hosting URL. Visit:

- `<url>/` — the static page (single-user, localStorage)
- `<url>/live/` (or `<url>/admin`) — the live page

Anyone visiting `/live/` sees the read-only view. Click **Admin sign in** in the header to enter your admin credentials and unlock editing. Live updates propagate to all connected viewers in real time.

### 4. (Optional) Static deploy via GitHub Pages

The static variant works on GitHub Pages with no extra setup — enable Pages on the branch and serve from `/`. The `live/` folder will also be served but won't function unless Firebase config is filled in (and Firebase doesn't host from GitHub Pages — auth/Firestore work, but the URL stays on github.io).

## Files reference

```
firebase.json         Hosting + Firestore CLI config (public: ".")
firestore.rules       allow read: true; allow write: if signed in
.firebaserc           created by `firebase use --add`
live/index.html       live variant entry
live/app.js           live controller (ES module, imports Firebase SDK from CDN)
live/firebase-config.js   YOUR project config — edit before deploy
```

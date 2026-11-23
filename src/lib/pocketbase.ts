import PocketBase from 'pocketbase';

// Production uses the current origin; development can override it in .env.local.
const pbUrl = import.meta.env.VITE_POCKETBASE_URL?.trim() || window.location.origin;
const pb = new PocketBase(pbUrl);

// Auto-Cancellation deaktivieren (für React 19 StrictMode und parallele Calls)
pb.autoCancellation(false);



export default pb;


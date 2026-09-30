/* Thin stub: /sw.js is the single root-scope worker and the single source of
   truth for Firebase web push config + notification icons
   (/icons/icon-192-v2.png). Kept only because some browsers/FCM SDKs probe
   this default path — it delegates everything to /sw.js so config is never
   duplicated. Rotation: update config in /sw.js only. */
importScripts("/sw.js");

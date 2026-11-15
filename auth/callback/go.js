/* Hand the sign-in result to the app. Supabase puts the session (or an
   error) in the address after # and sometimes ?, so both are carried over
   unchanged; the app reads them on load (captureHashTokens in api.js). */
location.replace('/' + location.search + location.hash);

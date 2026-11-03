"use client";
// Sign in with Google; Supabase handles the OAuth round trip and sends the user to /auth/callback
import { createClient } from "../../lib/supabase/client";

export default function Login() {
  async function signIn() {
    await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <main className="login">
      <section>
        <h1>ai-outreach</h1>
        <p className="muted">Upload leads, get personalized emails, see every cost.</p>
        <button onClick={signIn}>Sign in with Google</button>
      </section>
    </main>
  );
}

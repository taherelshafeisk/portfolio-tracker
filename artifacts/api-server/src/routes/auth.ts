import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase";

const router: IRouter = Router();

router.post("/signup", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    if (error.message.toLowerCase().includes("already") || error.status === 422) {
      res.status(409).json({ error: "Email already exists" });
    } else {
      res.status(400).json({ error: error.message });
    }
    return;
  }
  res.status(201).json({ userId: data.user.id, message: "Account created" });
});

router.post("/signin", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  res.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    userId: data.user.id,
  });
});

router.post("/signout", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await supabase.auth.admin.signOut(token);
  res.json({ message: "Signed out" });
});

router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body ?? {};
  if (!refreshToken) {
    res.status(400).json({ error: "refreshToken is required" });
    return;
  }
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    res.status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }
  res.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  });
});

router.get("/google", async (_req, res) => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: process.env.OAUTH_REDIRECT_URL },
  });
  if (error || !data.url) {
    res.status(500).json({ error: "Failed to generate Google OAuth URL" });
    return;
  }
  res.json({ url: data.url });
});

router.post("/verify", async (req, res) => {
  const { accessToken } = req.body ?? {};
  if (!accessToken) {
    res.status(400).json({ error: "accessToken is required" });
    return;
  }
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  res.json({ userId: data.user.id, accessToken });
});

export default router;

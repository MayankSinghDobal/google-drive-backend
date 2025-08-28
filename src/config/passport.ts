import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { supabase } from "./supabase";

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      callbackURL:
        process.env.NODE_ENV === "production"
          ? "https://google-drive-backend-ten.vercel.app/auth/google/callback"
          : "http://localhost:3000/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const { data: existingUser, error: userError } = await supabase
          .from("users")
          .select("id, email, name")
          .eq("email", profile.emails?.[0].value)
          .single();

        if (userError && userError.code !== "PGRST116") {
          return done(userError);
        }

        if (existingUser) {
          return done(null, existingUser);
        }

        const { data: newUser, error } = await supabase
          .from("users")
          .insert([
            { email: profile.emails?.[0].value, name: profile.displayName },
          ])
          .select("id, email, name")
          .single();

        if (error) {
          return done(error);
        }

        return done(null, newUser);
      } catch (err) {
        return done(err);
      }
    }
  )
);

passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: number, done) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("id, email, name")
      .eq("id", id)
      .single();

    if (error) {
      return done(error);
    }
    done(null, data);
  } catch (err) {
    done(err);
  }
});

export default passport;

-- Page tours of the web app: {"off":true} when disabled, {"seen":["build",...]} for tours already seen or skipped
ALTER TABLE users ADD COLUMN tours TEXT NOT NULL DEFAULT '{}';

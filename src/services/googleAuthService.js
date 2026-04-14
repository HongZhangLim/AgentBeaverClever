import { google } from "googleapis";

const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

export function getScopes() {
  const configured = process.env.GOOGLE_OAUTH_SCOPES?.trim();
  const configuredScopes = configured ? configured.split(/\s+/).filter(Boolean) : [];

  return [...new Set([...configuredScopes, ...REQUIRED_SCOPES])];
}

export function buildOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth environment variables are not fully configured");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthorizationUrl(oauthClient) {
  return oauthClient.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: getScopes(),
  });
}

export async function exchangeCodeForTokens(oauthClient, code) {
  const { tokens } = await oauthClient.getToken(code);
  if (!tokens?.refresh_token) {
    throw new Error("No refresh token received. Reconnect using consent prompt.");
  }

  return tokens;
}

export async function getAuthedClient(tokens) {
  const oauthClient = buildOAuthClient();
  oauthClient.setCredentials(tokens);

  await oauthClient.getAccessToken();

  const refreshed = {
    ...tokens,
    ...oauthClient.credentials,
    refresh_token: oauthClient.credentials.refresh_token || tokens.refresh_token,
  };

  return { oauthClient, refreshedTokens: refreshed };
}

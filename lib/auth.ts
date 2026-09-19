let cachedCookieValue = '';
let isLoggingIn = false;

export async function getSentinelCookie(): Promise<string> {
  if (cachedCookieValue) return cachedCookieValue;

  if (isLoggingIn) {
    // Wait for the other request to finish logging in
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return cachedCookieValue;
  }

  isLoggingIn = true;
  try {
    await doLogin();
    return cachedCookieValue;
  } finally {
    isLoggingIn = false;
  }
}

/** Force a fresh login (e.g. after a 403 "one session per IP"). */
export async function refreshSentinelCookie(): Promise<string> {
  cachedCookieValue = '';
  isLoggingIn = true;
  try {
    await doLogin();
    return cachedCookieValue;
  } finally {
    isLoggingIn = false;
  }
}

async function doLogin() {
  const email = (process.env.CAMERA_USER_EMAIL || '').trim();
  const token = (process.env.CAMERA_ACCESS_TOKEN || '').trim();
  const password = (process.env.CAMERA_USER_PASSWORD || '').trim();
  const actualPassword = token || password;

  const loginUrl = 'https://cctv.corp8.cloud/auth/login';
  const loginRes = await fetch(loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password: actualPassword }).toString(),
    redirect: 'manual',
  });

  const setCookie = loginRes.headers.get('set-cookie');
  if (setCookie) {
    // Extract just the cookie name=value part, e.g. "sentinel=abc123"
    // The full header looks like: sentinel=abc123; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000
    const nameValue = setCookie.split(';')[0].trim();
    cachedCookieValue = nameValue;
    console.log('[auth] Login successful, got sentinel cookie');
  } else {
    throw new Error('Failed to get session cookie from /auth/login');
  }
}

import { NextResponse } from 'next/server';

let cachedCookie = '';
let isLoggingIn = false;

export async function getSentinelCookie(): Promise<string> {
  if (cachedCookie) return cachedCookie;
  
  if (isLoggingIn) {
    // Wait for the other request to finish logging in
    await new Promise((resolve) => setTimeout(resolve, 500));
    return cachedCookie;
  }
  
  isLoggingIn = true;
  try {
    const catalogueUrl = process.env.CAMERA_CATALOGUE_URL || 'https://cctv.corp8.cloud/cameras.json';
    const email = (process.env.CAMERA_USER_EMAIL || '').trim();
    const password = (process.env.CAMERA_USER_PASSWORD || '').trim();
    const token = (process.env.CAMERA_ACCESS_TOKEN || '').trim();
    const actualPassword = token || password;

    const loginUrl = new URL('/auth/login', catalogueUrl).href;
    const loginRes = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email, password: actualPassword }).toString(),
      redirect: 'manual'
    });

    const setCookie = loginRes.headers.get('set-cookie');
    if (setCookie) {
      cachedCookie = setCookie;
      return cachedCookie;
    } else {
      throw new Error("Failed to get session cookie from /auth/login");
    }
  } finally {
    isLoggingIn = false;
  }
}

export function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error('Enter a valid email address.');
  }
  return value;
}

export function validateCode(code: string): string {
  const value = code.trim();
  if (!/^\d{6,10}$/.test(value))
    throw new Error('Enter the code from your email.');
  return value;
}

export function identityError(error: unknown): string {
  const data =
    error && typeof error === 'object'
      ? (error as { code?: string; message?: string; status?: number })
      : {};
  if (
    data.status === 429 ||
    data.code === 'over_email_send_rate_limit' ||
    data.code === 'over_request_rate_limit'
  )
    return 'Too many requests. Wait a little before trying again.';
  if (data.code === 'otp_expired')
    return 'That code is invalid or expired. Check it or request a new code.';
  if (data.code === 'PGRST202' || data.code === '42P01')
    return 'Household sharing is not ready on the server yet. Please try again later.';
  if (data.code === '23505')
    return 'You already belong to a household. Refresh to see it.';
  if (data.code === '42501')
    return 'You no longer have permission for this action. Refresh your household.';
  // Our SQL business errors and local validation errors are safe to display.
  if (
    data.code === 'P0001' ||
    data.code === '22023' ||
    data.code === '54000' ||
    (error instanceof Error && error.constructor === Error)
  )
    return data.message || 'This action could not be completed.';
  return 'Couldn’t connect right now. Check your connection and try again.';
}

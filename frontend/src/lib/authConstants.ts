const tokenCookie = process.env.NEXT_PUBLIC_AUTH_TOKEN_COOKIE ?? "pharmshift_token";
const userCookie = process.env.NEXT_PUBLIC_AUTH_USER_COOKIE ?? "pharmshift_user";
const roleCookie = process.env.NEXT_PUBLIC_AUTH_ROLE_COOKIE ?? "pharmshift_role";

export const AUTH_TOKEN_COOKIE = tokenCookie;
export const AUTH_USER_COOKIE = userCookie;
export const AUTH_ROLE_COOKIE = roleCookie;
export const AUTH_STRATEGY = process.env.NEXT_PUBLIC_AUTH_STRATEGY ?? "mock";

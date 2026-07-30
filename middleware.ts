import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const isLoginPage = req.nextUrl.pathname === '/login';

    // Already authenticated users shouldn't see the login page.
    if (isLoginPage && token) {
      return NextResponse.redirect(new URL('/', req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ req, token }) => {
        // Always allow the login page through (the middleware fn handles the
        // authenticated-redirect). Everything else requires a session.
        if (req.nextUrl.pathname === '/login') return true;
        return !!token;
      },
    },
    pages: {
      signIn: '/login',
    },
  },
);

// Protect all page routes. API routes are excluded and self-protect:
//  - /api/process and /api/stats verify the session via getServerSession
//  - /api/webhook is a public endpoint (optional WEBHOOK_SECRET)
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};

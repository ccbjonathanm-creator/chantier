const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://api.groq.com https://sksyieafxqhlrhmcyafo.supabase.co wss://sksyieafxqhlrhmcyafo.supabase.co https://cloud.umami.is; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') return Response.redirect(new URL('/chantier/', url), 302);
    if (url.pathname === '/chantier') return Response.redirect(new URL('/chantier/', url), 302);
    if (!url.pathname.startsWith('/chantier/')) return new Response('Page introuvable', { status: 404 });
    url.pathname = url.pathname.slice('/chantier'.length);
    const response = await env.ASSETS.fetch(new Request(url, request));
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', CSP);
    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('Cache-Control', 'no-cache');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
};

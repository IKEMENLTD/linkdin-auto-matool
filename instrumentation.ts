/**
 * Next.js 15 instrumentation hook.
 * Sentry / OpenTelemetry / PostHog の本配線は Phase2 で実装。
 * 設計書 §16 / §24 を参照。
 */
export async function register() {
  // 例: Sentry を使う場合
  // if (process.env.NEXT_RUNTIME === "nodejs") {
  //   await import("./sentry.server.config");
  // }
  // if (process.env.NEXT_RUNTIME === "edge") {
  //   await import("./sentry.edge.config");
  // }
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routePath: string; routeType: string }
) {
  // 本番では Sentry.captureException をここに。
  if (process.env.NODE_ENV !== "production") {
    console.error("[onRequestError]", { err, path: request.path, route: context.routePath });
  }
}

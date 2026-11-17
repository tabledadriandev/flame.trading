// The functions read two environment variables and nothing else from Node, so
// this declares just that instead of pulling Node's types into a browser project.
declare const process: { env: Record<string, string | undefined> };

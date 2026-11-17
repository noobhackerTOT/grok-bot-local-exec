const OLD =
  "async function f4(r){let{root:e,path:t}=r,n=fr(t,e);" +
  "if(yBe(e,n))throw new Mw(`Path is outside the allowed local-exec root and was refused: ${t}`);";

const NEW =
  "async function f4(r){let{root:e,path:t}=r,n=fr(t,e);" +
  'if(yBe(e,n)&&!(typeof globalThis.__sandExtraRootOk=="function"&&globalThis.__sandExtraRootOk(n,t)))' +
  "throw new Mw(`Path is outside the allowed local-exec root and was refused: ${t}`);" +
  'if(typeof globalThis.__sandExtraRootOk=="function"&&globalThis.__sandExtraRootOk(n,t)&&yBe(e,n))return n;';

export function patchMainCjs(source) {
  if (source.includes('globalThis.__sandExtraRootOk')) {
    return { text: source, status: "already" };
  }
  if (!source.includes(OLD)) {
    return { text: source, status: "missing" };
  }
  return { text: source.replace(OLD, NEW), status: "patched" };
}

export { OLD, NEW };

/**
 * Lets non-React modules (player helpers) navigate with the Next router. The root provider
 * registers `router.push`; before that, a full navigation is the safe fallback.
 */
let push: (href: string) => void = (href) => {
  window.location.href = href;
};

export function registerNavigator(fn: (href: string) => void): void {
  push = fn;
}

export function navigate(href: string): void {
  push(href);
}

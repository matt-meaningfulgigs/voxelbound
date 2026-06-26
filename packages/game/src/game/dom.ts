export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string; html?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: cls, html, ...rest } = props as Record<string, unknown>;
  if (cls) node.className = cls as string;
  if (html !== undefined) node.innerHTML = html as string;
  Object.assign(node, rest);
  for (const c of children) node.append(c);
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function show(node: HTMLElement, visible: boolean, display = 'block'): void {
  node.style.display = visible ? display : 'none';
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

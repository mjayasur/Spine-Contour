export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined) continue;
      if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'class') {
        node.setAttribute('class', value);
      } else if (key in node) {
        node[key] = value;
      } else {
        node.setAttribute(key, value);
      }
    }
  }
  const flatChildren = children.flat(Infinity);
  for (const child of flatChildren) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(node, child) {
  clear(node);
  node.append(child);
}

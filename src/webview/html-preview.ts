// Static HTML only. Build fresh allowlisted elements from an inert template;
// never attach authored markup, executable elements, URLs, or event handlers.
const tags = new Set(
  'a abbr article aside b blockquote br button caption code col colgroup dd del details div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i input kbd label legend li main mark nav ol p pre progress s samp section small span strong sub summary sup table tbody td textarea th thead time tr u ul'.split(
    ' ',
  ),
);
const attributes = new Set(
  'class id title role dir lang colspan rowspan scope open value max min placeholder type checked disabled'.split(
    ' ',
  ),
);
const namespace = 'http://www.w3.org/1999/xhtml';

function declarations(source: CSSStyleDeclaration): string {
  const result = document.createElement('div').style;
  for (const property of source) {
    const value = source.getPropertyValue(property);
    // Reject escaped resource functions too. Custom properties may otherwise
    // defer a URL until var() is substituted into another declaration.
    if (/\\|\/\*|url\s*\(|image(?:-set)?\s*\(|src\s*\(|expression\s*\(/i.test(value)) continue;
    if (property === 'behavior' || property === '-moz-binding') continue;
    result.setProperty(property, value, source.getPropertyPriority(property));
  }
  return result.cssText;
}

function stylesheet(css: string): string {
  const sheet = new CSSStyleSheet();
  // replaceSync discards @import without fetching it. Only ordinary rules and
  // conditional groups survive; @font-face and other resource rules do not.
  sheet.replaceSync(css);
  function rules(list: CSSRuleList): string {
    return [...list]
      .map((rule) => {
        if (rule instanceof CSSStyleRule) {
          // Shadow selectors must never target the host or distributed content.
          if (/\\|:host|::slotted|::part/i.test(rule.selectorText)) return '';
          return `${rule.selectorText} { ${declarations(rule.style)} }`;
        }
        if (rule instanceof CSSMediaRule)
          return `@media ${rule.conditionText} { ${rules(rule.cssRules)} }`;
        if (rule instanceof CSSSupportsRule)
          return `@supports ${rule.conditionText} { ${rules(rule.cssRules)} }`;
        return '';
      })
      .join('\n');
  }
  return rules(sheet.cssRules);
}

/** Render static fragments in a scoped, clipped shadow tree, including in SVG previews. */
export function renderHtmlPreview(host: HTMLElement, html: string, css: string): void {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  const template = document.createElement('template');
  template.innerHTML = html;
  const styles: string[] = [];
  function clean(node: Node): Node | undefined {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? '');
    if (!(node instanceof Element) || node.namespaceURI !== namespace) return;
    if (node.localName === 'style') {
      styles.push(stylesheet(node.textContent ?? ''));
      return;
    }
    if (!tags.has(node.localName)) return;
    const element = document.createElement(node.localName);
    for (const attribute of node.attributes) {
      if (attributes.has(attribute.name) || /^aria-[a-z-]+$/.test(attribute.name)) {
        element.setAttribute(attribute.name, attribute.value);
      }
    }
    // No file pickers or active controls; cards remain selectable/draggable.
    if (element instanceof HTMLInputElement) {
      if (
        ![
          'text',
          'number',
          'checkbox',
          'radio',
          'range',
          'color',
          'date',
          'email',
          'password',
          'search',
          'tel',
          'time',
          'url',
        ].includes(element.type)
      )
        element.type = 'text';
    }
    if (node instanceof HTMLElement) element.style.cssText = declarations(node.style);
    for (const child of node.childNodes) {
      const safe = clean(child);
      if (safe) element.appendChild(safe);
    }
    return element;
  }
  // A fragment avoids adding an internal div that authored selectors (e.g.
  // div { padding: 24px }) would style a second time.
  const content = document.createDocumentFragment();
  for (const child of template.content.childNodes) {
    const safe = clean(child);
    if (safe) content.appendChild(safe);
  }
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; display: block; width: 100%; height: 100%; contain: strict; overflow: hidden; pointer-events: none; color: #27334b; font: 16px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    *, *::before, *::after { box-sizing: border-box; animation: none !important; transition: none !important; }
    ${styles.join('\n')}\n${stylesheet(css)}`;
  host.inert = true;
  shadow.replaceChildren(style, content);
}

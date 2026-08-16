// Minimal XML reader/writer for the XLIFF 1.2 shape rohy emits and imports.
//
// Deliberately small: elements, attributes (single/double quoted), text,
// CDATA, comments, processing instructions, the five named entities plus
// numeric character references. No DTD, no namespaces resolution (prefixes
// stay in the name), no external entities — which is also why this is safer
// than a general-purpose parser for a file that came back from a third party.
// fast-xml-parser is not a dependency of the repo; this keeps it that way.

const NAMED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Escape for element text: & < > (quotes are legal in text). */
export function escapeText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape for a double-quoted attribute value. */
export function escapeAttr(s) {
    return escapeText(s).replace(/"/g, '&quot;');
}

export function unescapeXml(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, ref) => {
        if (ref[0] === '#') {
            const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
            return String.fromCodePoint(code);
        }
        if (ref in NAMED) return NAMED[ref];
        throw new Error(`Unknown entity &${ref};`);
    });
}

/**
 * Parse an XML document into { name, attrs, children } nodes; text children
 * are plain strings. Returns the root element. Throws on malformed input.
 */
export function parseXml(input) {
    const src = input.replace(/^﻿/, '');
    let i = 0;
    const root = { name: '#document', attrs: {}, children: [] };
    const stack = [root];
    const top = () => stack[stack.length - 1];
    const fail = (msg) => { throw new Error(`XML parse error at offset ${i}: ${msg}`); };

    while (i < src.length) {
        if (src[i] !== '<') {
            const end = src.indexOf('<', i);
            const text = src.slice(i, end === -1 ? src.length : end);
            if (stack.length > 1) top().children.push(unescapeXml(text));
            else if (text.trim()) fail('text outside the root element');
            i = end === -1 ? src.length : end;
            continue;
        }
        if (src.startsWith('<!--', i)) {
            const end = src.indexOf('-->', i + 4);
            if (end === -1) fail('unterminated comment');
            i = end + 3;
            continue;
        }
        if (src.startsWith('<![CDATA[', i)) {
            const end = src.indexOf(']]>', i + 9);
            if (end === -1) fail('unterminated CDATA');
            if (stack.length === 1) fail('CDATA outside the root element');
            top().children.push(src.slice(i + 9, end));
            i = end + 3;
            continue;
        }
        if (src.startsWith('<?', i)) {
            const end = src.indexOf('?>', i + 2);
            if (end === -1) fail('unterminated processing instruction');
            i = end + 2;
            continue;
        }
        if (src.startsWith('<!', i)) {
            // DOCTYPE — accepted only in its simplest form, never expanded.
            const end = src.indexOf('>', i + 2);
            if (end === -1) fail('unterminated declaration');
            if (src.slice(i, end).includes('[')) fail('internal DTD subsets are not supported');
            i = end + 1;
            continue;
        }
        if (src.startsWith('</', i)) {
            const end = src.indexOf('>', i + 2);
            if (end === -1) fail('unterminated end tag');
            const name = src.slice(i + 2, end).trim();
            if (stack.length === 1 || top().name !== name) fail(`unexpected </${name}>`);
            stack.pop();
            i = end + 1;
            continue;
        }
        // Start tag
        i += 1;
        const nameMatch = /^[A-Za-z_:][\w:.-]*/.exec(src.slice(i));
        if (!nameMatch) fail('malformed start tag');
        const node = { name: nameMatch[0], attrs: {}, children: [] };
        i += nameMatch[0].length;
        let selfClosing = false;
        for (;;) {
            while (i < src.length && /\s/.test(src[i])) i += 1;
            if (i >= src.length) fail('unterminated start tag');
            if (src[i] === '>') { i += 1; break; }
            if (src.startsWith('/>', i)) { selfClosing = true; i += 2; break; }
            const attrMatch = /^([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(src.slice(i));
            if (!attrMatch) fail(`malformed attribute in <${node.name}>`);
            node.attrs[attrMatch[1]] = unescapeXml(attrMatch[3] ?? attrMatch[4]);
            i += attrMatch[0].length;
        }
        if (stack.length === 1 && root.children.some(c => typeof c !== 'string')) fail('multiple root elements');
        top().children.push(node);
        if (!selfClosing) stack.push(node);
    }
    if (stack.length !== 1) fail(`unclosed <${top().name}>`);
    const rootEl = root.children.find(c => typeof c !== 'string');
    if (!rootEl) fail('empty document');
    return rootEl;
}

export const childElements = (node, name) =>
    node.children.filter(c => typeof c !== 'string' && (!name || c.name === name));

export const firstChild = (node, name) => childElements(node, name)[0];

/** Concatenated text content (elements' own text; nested markup is flattened). */
export function textOf(node) {
    if (!node) return '';
    return node.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
}

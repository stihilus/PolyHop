import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_OPTIONS, FONT_FILE, PLAYER_FILE, exportFileName, jsonForHtml, packageFiles, playerHtml, zipPackage } from '../src/core/exportPackage';
import { createDefaultProject, normalizeProject } from '../src/core/types';

const enc = new TextEncoder();
const dec = new TextDecoder();

describe('export package', () => {
  it('keeps a script from ending early through the data it carries', () => {
    const evil = { name: '</script><script>alert(1)</script>', note: '<!-- x -->', ls: 'a b' };
    const text = jsonForHtml(evil);
    expect(text).not.toContain('</script');
    expect(text).not.toContain('<!--');
    expect(text).not.toContain(' ');
    expect(JSON.parse(text)).toEqual(evil);
  });

  it('puts the project into the page and the page into a zip with the player and the font', () => {
    const project = createDefaultProject();
    project.settings.name = 'Mario & <Luigi> "Bros"';
    const json = JSON.stringify(project);
    const files = packageFiles({
      title: project.settings.name,
      projectJson: json,
      options: DEFAULT_EXPORT_OPTIONS,
      playerJs: enc.encode('console.log("player")'),
      font: new Uint8Array([1, 2, 3]),
    });
    expect(Object.keys(files).sort()).toEqual([FONT_FILE, PLAYER_FILE, 'index.html'].sort());

    const back = unzipSync(zipPackage(files));
    const html = dec.decode(back['index.html']!);
    expect(html).toContain('<title>Mario &amp; &lt;Luigi&gt; &quot;Bros&quot;</title>');
    expect(html).toContain(`src="${PLAYER_FILE}"`);
    expect(html).toContain(FONT_FILE);
    // the project is in the page and reads back as the same project
    const m = /<script type="application\/json" id="polyhop-project">([\s\S]*?)<\/script>/.exec(html);
    expect(m).not.toBeNull();
    const loaded = normalizeProject(JSON.parse(m![1]!));
    expect(loaded.settings.name).toBe(project.settings.name);
    expect(loaded.levels[0]!.objects).toHaveLength(project.levels[0]!.objects.length);
    expect(Array.from(back[FONT_FILE]!)).toEqual([1, 2, 3]);
    expect(dec.decode(back[PLAYER_FILE]!)).toBe('console.log("player")');
  });

  it('leaves the font out when there is none, and refuses a page color that is not a color', () => {
    const files = packageFiles({
      title: 't',
      projectJson: '{}',
      options: { showControls: false, background: 'red;} body{display:none' },
      playerJs: enc.encode(''),
      font: null,
    });
    expect(Object.keys(files)).not.toContain(FONT_FILE);
    const html = dec.decode(files['index.html']!);
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    expect(style).not.toContain('display:none');
    expect(style).toContain('background:#14161b');
    expect(html).not.toContain('@font-face');
  });

  it('names the zip after the game', () => {
    expect(exportFileName('My Platformer')).toBe('my-platformer-html5.zip');
    expect(exportFileName('  Žaba & Čuvari  ')).toBe('zaba-cuvari-html5.zip');
    expect(exportFileName('Đurđevak')).toBe('djurdjevak-html5.zip');
    expect(exportFileName('???')).toBe('game-html5.zip');
  });

  it('builds a page of reasonable size', () => {
    const html = playerHtml({ title: 'x', projectJson: '{"a":1}', options: DEFAULT_EXPORT_OPTIONS, fontFile: null, scriptSrc: 'p.js' });
    expect(html.length).toBeLessThan(2000);
    expect(html).toContain('<script src="p.js"></script>');
  });
});

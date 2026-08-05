'use strict';
// PELNA LISTA zmian, ktore Patcher wprowadza.
//
// Dwa rodzaje pozycji:
//  - OPTYMALIZACJE - wpisane na sztywno tutaj, bo to wiedza wypracowana pomiarami
//    (uzasadnienie kazdej: docs/OPTIMIZATIONS-SPEC.md, dowody: docs/ram/).
//  - MODY - budowane z katalogu wydan (sources.json), wiec dolozenie moda albo
//    czyjegos repozytorium nie wymaga ruszania kodu.

const path = require('path');
const { STYLES } = require('./textconfig');
const { setKey, setJson, installFile, disableMods, fileResource } = require('./changes');
const assets = require('./assets');
const catalog = require('./catalog');

/** Grupy pokazywane w interfejsie; kolejnosc = kolejnosc na liscie. */
const GROUPS = [
  { id: 'optimizations', label: 'Optymalizacje', description: 'RAM, configi, flagi JVM - wypracowane pomiarami' },
  { id: 'mods', label: 'Mody i zasoby', description: 'Wydania z repozytoriow (sources.json) + shaderpack' },
  { id: 'tools', label: 'Programy wspierajace', description: 'Narzedzia systemowe uruchamiane obok gry' },
];

/** Flagi JVM z OPTIMIZATIONS-SPEC.md sekcja D (zweryfikowane pomiarem: -3 GB commitu). */
const JVM_ARGS = [
  '-XX:+UseG1GC',
  '-XX:MaxGCPauseMillis=50',
  '-XX:G1HeapRegionSize=8M',
  '-XX:MinHeapFreeRatio=10',
  '-XX:MaxHeapFreeRatio=30',
  '-XX:G1PeriodicGCInterval=15000',
  '-XX:G1PeriodicGCSystemLoadThreshold=0',
  '-XX:+UseStringDeduplication',
  '-XX:NativeMemoryTracking=summary',
].join(' ');

/**
 * Waskie prefiksy pakietow Xaero. NIE ma tu "xaero/pac/" - to Open Parties and
 * Claims, inny mod tego samego autora (szeroki token "xaero/" dawal falszywe
 * alarmy na sophisticatedcore).
 */
const XAERO_TOKENS = ['xaero/common/', 'xaero/map/', 'xaero/hud/', 'xaero/minimap/'];

function optimizations() {
  const SHADERPACK = assets.shaderpack();
  const option = (key, value) => setKey({
    target: i => i.options, label: 'options.txt', key, style: STYLES.options, value,
  });
  const shaderKey = (key, value) => setKey({
    target: i => path.join(i.shaderpacks, SHADERPACK + '.txt'),
    label: 'shaderpacks/' + SHADERPACK + '.txt', key, style: STYLES.properties, value,
  });
  const prism = (key, value) => setKey({
    target: i => i.prismCfg || path.join(i.root, 'instance.cfg'),
    label: 'instance.cfg', section: 'General', key, style: STYLES.ini, value,
  });

  const list = [
    {
      id: 'aaa-particles-gc', side: 'client',
      title: 'Effekseer: auto-zwalnianie pamieci czastek pod presja RAM',
      doc: 'OPTIMIZATIONS-SPEC.md sekcja A1',
      why: 'Zwalnia do ~1 GB natywnej pamieci czastek, gdy wolny RAM spada ponizej ~1,5 GB.',
      changes: [setKey({
        target: i => path.join(i.config, 'aaa_particles-client.toml'),
        label: 'config/aaa_particles-client.toml', section: 'gc', key: 'enabled',
        style: STYLES.toml, value: 'true',
      })],
    },
    {
      id: 'ferritecore-compact', side: 'both',
      title: 'FerriteCore: kompaktowa reprezentacja block states',
      doc: 'OPTIMIZATIONS-SPEC.md sekcja A3',
      why: 'Mniejsza reprezentacja stanow blokow. Koszt: minimalnie wolniejsze odczyty.',
      changes: [setKey({
        target: i => path.join(i.config, 'ferritecore-mixin.toml'),
        label: 'config/ferritecore-mixin.toml', key: 'compactFastMap',
        style: STYLES.toml, value: 'true',
      })],
    },
    {
      id: 'alltheleaks-guard', side: 'both',
      title: 'AllTheLeaks: pilnowanie, ze dedup sterty POZOSTAJE wylaczony',
      doc: 'OPTIMIZATIONS-SPEC.md sekcja A2',
      why: 'Wlaczenie dedupu wywala gre przy wejsciu do swiata (ATLUnsupportedOperation).',
      changes: [
        setJson({ target: i => path.join(i.config, 'alltheleaks.json'), label: 'config/alltheleaks.json', key: 'ingredientDedupe', value: 'false' }),
        setJson({ target: i => path.join(i.config, 'alltheleaks.json'), label: 'config/alltheleaks.json', key: 'resourceLocationDedupe', value: 'false' }),
      ],
    },
    {
      id: 'modernfix-dynres', side: 'client',
      title: 'ModernFix: leniwe ladowanie modeli i tekstur',
      doc: 'OPTIMIZATIONS-SPEC.md sekcja A4',
      why: 'Najwieksza galka ModernFixa - modele i tekstury ladowane na zadanie.',
      changes: [setKey({
        target: i => path.join(i.config, 'modernfix-mixins.properties'),
        label: 'config/modernfix-mixins.properties', key: 'mixin.perf.dynamic_resources',
        style: STYLES.properties, value: 'true',
      })],
    },
    {
      id: 'game-options', side: 'client',
      title: 'options.txt: simulationDistance, mipmapLevels, entityShadows, particles',
      doc: 'OPTIMIZATIONS-SPEC.md sekcja C',
      why: 'Mniej tykanych chunkow, mniej VRAM na mipmapy, drobne zyski GPU.',
      changes: [
        option('simulationDistance', '8'),
        option('mipmapLevels', '2'),
        option('entityShadows', 'false'),
        option('particles', '0'),
      ],
    },
    {
      id: 'render-distance', side: 'client',
      title: 'options.txt: renderDistance wg profilu',
      doc: 'OPTIMIZATIONS-SPEC.md sekcja C + E',
      why: 'Najwieksza galka RAM po stronie gry - dane i meshe chunkow rosna kwadratowo.',
      changes: [option('renderDistance', opts => String(opts.renderDistance))],
    },
    {
      id: 'prism-jvm', side: 'client',
      title: 'Prism: flagi JVM (G1 oddaje pamiec) + Xmx/Xms',
      doc: 'OPTIMIZATIONS-SPEC.md sekcja D',
      why: 'Zmierzone: commit 13,1 -> 10,1 GB. G1 trzymal 3,8 GB pustej sterty i nie oddawal.',
      changes: [
        prism('OverrideJavaArgs', 'true'),
        prism('OverrideMemory', 'true'),
        prism('MinMemAlloc', '512'),
        prism('MaxMemAlloc', opts => String(opts.xmx)),
        prism('JvmArgs', '"' + JVM_ARGS + '"'),
      ],
    },
  ];

  if (SHADERPACK) {
    list.push({
      id: 'shaders-light', side: 'client',
      title: "Shadery: profil 'light' (mniej pamieci, wyglad zachowany)",
      doc: 'OPTIMIZATIONS-SPEC.md sekcja B',
      why: 'Woksele kolorowego swiatla 4x mniejsze, mniejsza mapa cieni, bez anizotropii.',
      changes: [
        shaderKey('COLORED_LIGHTING', '32'),
        shaderKey('shadowDistance', '48.0'),
        shaderKey('ANISOTROPIC_FILTER', '0'),
      ],
    });
  }

  return list.map(p => ({ ...p, group: 'optimizations' }));
}

function content() {
  const SHADERPACK = assets.shaderpack();
  const items = [];

  if (SHADERPACK) {
    items.push({
      id: 'shaderpack', side: 'client', group: 'mods',
      title: 'Shaderpack ' + SHADERPACK,
      doc: 'OPTIMIZATIONS-SPEC.md sekcja B + F',
      why: 'Pakietu NIE MA w bazowej paczce z CurseForge - dolozylismy go recznie.',
      changes: [
        installFile({ resource: 'shaderpacks/' + SHADERPACK, target: i => path.join(i.shaderpacks, SHADERPACK), label: 'shaderpacks/' + SHADERPACK, onlyIfMissing: true }),
        installFile({ resource: 'shaderpacks/' + SHADERPACK + '.txt', target: i => path.join(i.shaderpacks, SHADERPACK + '.txt'), label: 'shaderpacks/' + SHADERPACK + '.txt', onlyIfMissing: true }),
        setKey({ target: i => path.join(i.config, 'oculus.properties'), label: 'config/oculus.properties', key: 'shaderPack', style: STYLES.properties, value: SHADERPACK }),
        setKey({ target: i => path.join(i.config, 'oculus.properties'), label: 'config/oculus.properties', key: 'enableShaders', style: STYLES.properties, value: 'true' }),
      ],
    });
  }

  // Mody z wydan. Kazde zrodlo z sources.json to jedna pozycja planu; gdy pliku
  // jeszcze nie pobrano, pozycja i tak jest widoczna i mowi, czego brakuje.
  for (const mod of catalog.resolved()) {
    const name = mod.assetName || mod.asset;
    const reason = mod.error ? `nie pobrano (${mod.error})` : 'nie pobrano jeszcze zadnego wydania';
    items.push({
      id: 'mod-' + mod.id, side: mod.side || 'both', group: 'mods',
      title: `${mod.name}${mod.tag ? ' ' + mod.tag : ''}`,
      doc: mod.doc || mod.repo,
      why: (mod.why ? mod.why + ' ' : '') + `Zrodlo: ${mod.repo} (${mod.from || 'brak'}).`,
      changes: [installFile({
        resource: fileResource(mod.file, reason),
        target: i => path.join(i.mods, name),
        label: 'mods/' + name,
        replaceGlob: mod.replaceGlob || null,
      })],
    });
  }

  items.push({
    // TAKZE NA SERWERZE. Xaero nie ustawia displayTest, wiec Forge domyslnie wymusza
    // zgodnosc listy modow: serwer z Xaero ODRZUCA klienta, ktory go nie ma
    // ("Your client is missing the following mods").
    id: 'xaero-off', side: 'both', group: 'mods',
    title: 'Wylaczenie Xaero (minimapa, worldmap, most FTB)',
    doc: 'OPTIMIZATIONS-SPEC.md sekcja G',
    why: 'Xaero trzyma w RAM kafle map i renderuje minimape co klatke. Zastapione mapatlasem. '
       + 'Na serwerze konieczne takze dlatego, ze serwer z Xaero nie wpusci klienta bez Xaero.',
    changes: [disableMods({
      prefixes: ['xaerominimap', 'xaeroworldmap', 'ftbxaerocompat'],
      scan: { tokens: XAERO_TOKENS },
    })],
  });

  return items;
}

function all() {
  return [...optimizations(), ...content()];
}

module.exports = { all, GROUPS, JVM_ARGS, XAERO_TOKENS };

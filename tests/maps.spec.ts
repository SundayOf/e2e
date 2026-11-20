import { rememberCreated, saveOwned } from './helpers/owned';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './helpers/test';
import {
  chooseTag, deleteVirtualDevice, ensureProject, ensureVirtualDevice, ensureVirtualTag,
  openDeviceTags, openDeviceTree, openProject, projectName, setTagValue, signIn,
} from './helpers/scada';
import { deleteViewRow, openViewList, viewRow } from './helpers/view';

type Location = { lat: number; lon: number; zoom: number };
type Feature = { get(key: string): unknown; getGeometry(): { getCoordinates(): number[] } };
type MapWindow = Window & { os?: { maps?: { init?: { data?: { pointer?: { map?: {
  getTargetElement(): HTMLElement;
  getSize(): number[];
  getView(): { getCenter(): number[]; getZoom(): number; getResolution(): number; getProjection(): { getCode(): string } };
  getPixelFromCoordinate(coordinate: number[]): number[];
  forEachFeatureAtPixel(pixel: number[], callback: (feature: Feature) => Feature | undefined): Feature | undefined;
  getLayers(): { getArray(): { getSource(): { getFeatures?: () => Feature[] } }[] };
} } } } } } };
type OwnMap = { name: string; id: string; markerId: string; markerName: string; knownIds: Set<string> };
type Cleanup = (action: () => Promise<void>) => void;
const tileRequests = new WeakMap<Page, Set<string>>();

test.use({ actionTimeout: 10_000 });
test.beforeEach(async ({ page }) => {
  tileRequests.set(page, new Set());
  await page.route(url => /(^|\.)tile\.openstreetmap\.org$/.test(url.hostname) && /^\/\d+\/\d+\/\d+\.png$/.test(url.pathname), async route => {
    const [z, x, y] = new URL(route.request().url()).pathname.match(/\d+/g)!.map(Number);
    tileRequests.get(page)!.add(`${z}/${x}/${y}`);
    const color = tileColor(z, x, y);
    await route.fulfill({ contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' },
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="rgb(${color.slice(0, 3).join(',')})"/></svg>` });
  });
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
});

const tileColor = (z: number, x: number, y: number) => [40 + x % 180, 40 + y % 180, 40 + z * 10, 255];
const project = ({ lat, lon }: Pick<Location, 'lat' | 'lon'>) => [
  6378137 * lon * Math.PI / 180,
  6378137 * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)),
];
const claimId = (value: unknown, known: Set<string>) => {
  if (typeof value !== 'string' || !/^[a-f\d]{32}$/i.test(value)) throw new Error('Сервер не вернул ID созданного объекта');
  expect(known.has(value), 'Существующий объект не становится собственным').toBe(false);
  known.add(value);
  return value;
};

async function openObjects(page: Page, map: OwnMap) {
  await openViewList(page, 'Карты');
  const row = page.locator(`#table_option tr[rec_id="${map.id}"]`);
  await expect(row.getByRole('cell', { name: map.name, exact: true })).toBeVisible();
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === `/edit_map_objects/${map.id}/` && r.ok(), { timeout: 10_000 });
  await row.locator('td.tag2[onclick*="os.maps.objects.list"]').click();
  await (await loaded).finished();
  await expect(page.locator('#header_main > div:first-child')).toContainText(`Объекты для карты «${map.name}»`);
}

async function removeMarker(page: Page, map: OwnMap) {
  if (!map.markerId) return;
  await openObjects(page, map);
  const row = page.locator(`#table_option tr[rec_id="${map.markerId}"]`);
  if (await row.count()) {
    const [deleted] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === `/delete_map_object/${map.id}/` && r.request().method() === 'POST', { timeout: 10_000 }),
      deleteViewRow(page, row, 'Удалить объект(ы)?'),
    ]);
    expect(deleted.ok()).toBe(true);
    expect((await deleted.json()).error).toBeFalsy();
  }
  await openObjects(page, map);
  await expect(page.locator(`#table_option tr[rec_id="${map.markerId}"]`)).toHaveCount(0);
  map.markerId = '';
}

async function createMap(page: Page, onCleanup: Cleanup, info: TestInfo, name: string, location: Location) {
  await openViewList(page, 'Карты');
  await expect(viewRow(page, name), 'Занятую карту не изменяем').toHaveCount(0);
  const ids = await page.locator('#table_option tr[rec_id]').evaluateAll(rows => rows.map(row => row.getAttribute('rec_id')!));
  const map: OwnMap = { name, id: '', markerId: '', markerName: '', knownIds: new Set(ids) };
  onCleanup(async () => {
    if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('Карта перед очисткой.png'), timeout: 3000 }).catch(() => {});
    if (await page.locator('#div_msg .msg_close').isVisible()) await page.locator('#div_msg .msg_close').click();
    if (await page.locator('#my_confirm').isVisible()) await page.locator('#btn_cancel_confirm').click();
    for (const id of ['form_edit_map_objects', 'form_edit_map']) {
      const form = page.locator(`#${id}`);
      if (await form.isVisible()) await form.locator('#form_cancel').click();
    }
    if (!map.id) return;
    await removeMarker(page, map);
    await openObjects(page, map);
    await expect(page.locator('#table_option tr[rec_id]'), 'Чужие зависимые объекты не удаляем каскадом').toHaveCount(0);
    await openViewList(page, 'Карты');
    const row = page.locator(`#table_option tr[rec_id="${map.id}"]`);
    await expect(row.locator('td.tag2[onclick*="os.maps.points.list"]'), 'Карта с чужими местами не удаляется').toHaveText('0');
    const [deleted] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/delete_map/' && r.request().method() === 'POST', { timeout: 10_000 }),
      deleteViewRow(page, row, 'Удалить карту(ы)?'),
    ]);
    expect(deleted.ok()).toBe(true);
    expect((await deleted.json()).error).toBeFalsy();
    await openViewList(page, 'Карты');
    await expect(page.locator(`#table_option tr[rec_id="${map.id}"]`)).toHaveCount(0);
    map.id = '';
  });
  await page.locator('#header_main .btn_add[onclick="os.maps.edit(\'-\')"]').click();
  const form = page.locator('#form_edit_map');
  await form.locator('#name').fill(name);
  for (const key of ['lat', 'lon'] as const) await form.locator(`#${key}`).fill(String(location[key]));
  await form.locator('#scale').fill(String(location.zoom));
  const created = page.waitForResponse(r => new URL(r.url()).pathname === '/save_map//' && r.request().method() === 'POST', { timeout: 10_000 });
  await form.locator('#form_ok').click();
  const response = await created;
  const result = await response.json();
  map.id = claimId(result.map_id, map.knownIds);
  expect(response.ok()).toBe(true);
  expect(result.error).toBeFalsy();
  rememberCreated(page, map.id);
  await expect(viewRow(page, name)).toHaveAttribute('rec_id', map.id);
  return map;
}

async function openMap(page: Page, map: OwnMap) {
  await openViewList(page, 'Карты');
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === `/init_map/${map.id}/` && r.ok(), { timeout: 10_000 });
  await page.locator(`#table_option tr[rec_id="${map.id}"] td.map_`).click();
  await (await loaded).finished();
  await expect(page.locator('#main .ol-viewport')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const map = (window as MapWindow).os?.maps?.init?.data?.pointer?.map;
    return !!map && map.getTargetElement() === document.querySelector('#main') && map.getTargetElement().isConnected;
  })).toBe(true);
}

async function editMap(page: Page, map: OwnMap) {
  await openViewList(page, 'Карты');
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === `/edit_map/${map.id}/` && r.ok(), { timeout: 10_000 });
  await page.locator(`#table_option tr[rec_id="${map.id}"] td.edit`).click();
  await (await loaded).finished();
  const form = page.locator('#form_edit_map');
  await expect(form).toBeVisible();
  return form;
}

async function checkView(page: Page, location: Location) {
  const expected = project(location);
  const resolution = 2 * Math.PI * 6378137 / (256 * 2 ** location.zoom);
  await expect.poll(() => page.evaluate(({ expected, resolution, zoom }) => {
    const view = (window as MapWindow).os!.maps!.init!.data!.pointer!.map!.getView();
    const center = view.getCenter();
    return view.getProjection().getCode() === 'EPSG:3857' && Math.abs(view.getZoom() - zoom) < 0.001
      && Math.abs(view.getResolution() - resolution) < 0.001
      && center.every((value, i) => Math.abs(value - expected[i]) <= resolution);
  }, { expected, resolution, zoom: location.zoom })).toBe(true);
}

// Читаем настоящую отрисовку canvas; состояние и рендереры движка не вызываются для изменения карты.
async function pixels(page: Page, coordinate?: number[]) {
  return page.evaluate(coordinate => {
    const map = (window as MapWindow).os!.maps!.init!.data!.pointer!.map!;
    const pixel = coordinate ? map.getPixelFromCoordinate(coordinate) : map.getSize().map(value => value / 2);
    if (coordinate) pixel[1] -= 10;
    const viewport = document.querySelector('#main .ol-viewport')!.getBoundingClientRect();
    return Array.from(document.querySelectorAll<HTMLCanvasElement>('#main .ol-layer canvas')).flatMap(canvas => {
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height) return [];
      const x = Math.floor((viewport.x + pixel[0] - box.x) * canvas.width / box.width);
      const y = Math.floor((viewport.y + pixel[1] - box.y) * canvas.height / box.height);
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return [];
      return [Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data)];
    });
  }, coordinate);
}

async function markerHit(page: Page, id: string, coordinate: number[]) {
  return page.evaluate(({ id, coordinate }) => {
    const map = (window as MapWindow).os!.maps!.init!.data!.pointer!.map!;
    const pixel = map.getPixelFromCoordinate(coordinate);
    pixel[1] -= 10;
    const hit = map.forEachFeatureAtPixel(pixel, feature => feature.get('id') === id ? feature : undefined);
    return hit?.getGeometry().getCoordinates() || null;
  }, { id, coordinate });
}

async function openTree(page: Page) {
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/edit_devices/' && r.ok(), { timeout: 10_000 });
  await openDeviceTree(page);
  await (await loaded).finished();
}

async function createMapDevice(page: Page, onCleanup: Cleanup, name: string) {
  let deviceId = '';
  const device = page.locator('#panel_main2 #main .devices_tree_title').filter({ hasText: new RegExp(`^${name}$`) });
  await openTree(page);
  await expect(device, 'Занятое устройство не изменяем').toHaveCount(0);
  const deviceIds = new Set(await page.locator('#panel_main2 #main .devices_tree_title[node_id]').evaluateAll(rows => rows.map(row => row.getAttribute('node_id')!)));
  onCleanup(async () => {
    for (const id of ['form_edit2', 'form_edit_tag', 'form_edit_device_hub']) {
      const form = page.locator(`#${id}`);
      if (await form.isVisible()) await form.locator('.header > .close_form').click();
    }
    if (!deviceId) return;
    await openTree(page);
    if (await device.count()) {
      await expect(device).toHaveAttribute('node_id', deviceId);
      const [deleted] = await Promise.all([
        page.waitForResponse(r => new URL(r.url()).pathname === '/delete_device/' && r.request().method() === 'POST', { timeout: 10_000 }),
        deleteVirtualDevice(page, name),
      ]);
      expect(deleted.ok()).toBe(true);
      expect((await deleted.json()).error).toBeFalsy();
      await deleted.finished();
    }
    await openTree(page);
    await expect(page.locator(`.devices_tree_title[node_id="${deviceId}"]`)).toHaveCount(0);
    await expect(device).toHaveCount(0);
  });
  const created = page.waitForResponse(r => new URL(r.url()).pathname === '/save_device//' && r.request().method() === 'POST', { timeout: 10_000 });
  const row = await ensureVirtualDevice(page, name);
  const response = await created;
  const result = await response.json();
  deviceId = claimId(result.node_id, deviceIds);
  expect(response.ok()).toBe(true);
  expect(result.error).toBeFalsy();
  rememberCreated(page, deviceId);
  await expect(row).toHaveAttribute('node_id', deviceId);
}

test('Центр и масштаб рабочей карты', { tag: ['@map', '@map03', '@base'] }, async ({ page, onCleanup }, info) => {
  test.setTimeout(60_000);
  const initial = { lat: 55.75, lon: 37.62, zoom: 12 };
  const changed = { lat: 59.94, lon: 30.32, zoom: 10 };
  const map = await createMap(page, onCleanup, info, 'Расположение насосной', initial);
  for (const [index, location] of [initial, changed].entries()) {
    await test.step(index ? 'Сохранить новый центр и масштаб' : 'Проверить исходный центр и масштаб', async () => {
      const form = await editMap(page, map);
      if (index) {
        for (const key of ['lat', 'lon'] as const) await form.locator(`#${key}`).fill(String(location[key]));
        await form.locator('#scale').fill(String(location.zoom));
        const saved = page.waitForResponse(r => new URL(r.url()).pathname === `/save_map/${map.id}/` && r.request().method() === 'POST', { timeout: 10_000 });
        await form.locator('#form_ok').click();
        expect((await (await saved).json()).error).toBeFalsy();
        await editMap(page, map);
      }
      await expect(form.locator('#lat')).toHaveValue(String(location.lat));
      await expect(form.locator('#lon')).toHaveValue(String(location.lon));
      await expect(form.locator('#scale')).toHaveValue(String(location.zoom));
      await form.locator('#form_cancel').click();
      await openMap(page, map);
      await checkView(page, location);
      const n = 2 ** location.zoom;
      const x = Math.floor((location.lon + 180) / 360 * n);
      const lat = location.lat * Math.PI / 180;
      const y = Math.floor((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * n);
      await expect.poll(() => tileRequests.get(page)!.has(`${location.zoom}/${x}/${y}`), { timeout: 10_000 }).toBe(true);
      await expect.poll(() => pixels(page), { timeout: 10_000 }).toContainEqual(tileColor(location.zoom, x, y));
      await expect(page.locator('#main .ol-layer canvas').first()).toBeVisible();
    });
  }
});

test('Создание, перемещение и удаление маркера', { tag: ['@map', '@map04', '@base'] }, async ({ page, onCleanup }, info) => {
  test.setTimeout(60_000);
  const map = await createMap(page, onCleanup, info, 'Объекты водозабора', { lat: 55.75, lon: 37.62, zoom: 12 });
  const initial = { lat: 55.75, lon: 37.62 };
  const moved = { lat: 55.76, lon: 37.64 };
  map.markerName = 'Насосная станция';
  await test.step('Создать статический маркер', async () => {
    await openObjects(page, map);
    await expect(page.locator('#table_option tr[rec_id]')).toHaveCount(0);
    await page.locator('#header_main .btn_add[onclick="os.maps.objects.edit(\'\')"]').click();
    const form = page.locator('#form_edit_map_objects');
    await form.locator('#name').fill(map.markerName);
    await form.locator('#lat').fill(String(initial.lat));
    await form.locator('#lon').fill(String(initial.lon));
    await expect(form.locator('#enabled')).toBeChecked();
    await form.locator('#color').click();
    const palette = page.locator('#color_dialog_lite');
    await palette.locator('.QuickColor[title="#ff0000ff"]').click();
    await palette.locator('input.Ok').click();
    const created = page.waitForResponse(r => new URL(r.url()).pathname === '/save_map_object//' && r.request().method() === 'POST', { timeout: 10_000 });
    await form.locator('#form_ok').click();
    const response = await created;
    const result = await response.json();
    map.markerId = claimId(result.object_id, map.knownIds);
    expect(response.ok()).toBe(true);
    expect(result.error).toBeFalsy();
    rememberCreated(page, map.markerId);
  });

  const checkMarker = async (location: typeof initial) => {
    const coordinate = project(location);
    await openMap(page, map);
    if (await page.locator('#visible_panel_legend').isVisible()) await page.locator('#visible_panel_legend').click();
    const legend = page.locator(`#legend_table tr[rec_id="${map.markerId}"]`);
    await expect(legend).toBeVisible();
    await expect(legend).toContainText(map.markerName);
    await expect.poll(async () => {
      const hit = await markerHit(page, map.markerId, coordinate);
      return !!hit && hit.every((value, i) => Math.abs(value - coordinate[i]) < 0.01);
    }).toBe(true);
    await expect.poll(() => pixels(page, coordinate)).toContainEqual([255, 0, 0, 255]);
  };
  await test.step('Перечитать маркер и увидеть его на карте', async () => {
    await openObjects(page, map);
    await page.locator(`#table_option tr[rec_id="${map.markerId}"] td.edit`).click();
    const form = page.locator('#form_edit_map_objects');
    await expect(form.locator('#name')).toHaveValue(map.markerName);
    for (const key of ['lat', 'lon'] as const) await expect(form.locator(`#${key}`)).toHaveValue(String(initial[key]));
    await expect(form.locator('#color')).toHaveCSS('background-color', 'rgb(255, 0, 0)');
    await form.locator('#form_cancel').click();
    await checkMarker(initial);
  });
  await test.step('Переместить и переименовать маркер', async () => {
    await openObjects(page, map);
    await page.locator(`#table_option tr[rec_id="${map.markerId}"] td.edit`).click();
    const form = page.locator('#form_edit_map_objects');
    const name = 'Станция водозабора';
    await form.locator('#name').fill(name);
    for (const key of ['lat', 'lon'] as const) await form.locator(`#${key}`).fill(String(moved[key]));
    const saved = page.waitForResponse(r => new URL(r.url()).pathname === `/save_map_object/${map.markerId}/` && r.request().method() === 'POST', { timeout: 10_000 });
    await form.locator('#form_ok').click();
    expect((await (await saved).json()).error).toBeFalsy();
    map.markerName = name;
    await openObjects(page, map);
    await page.locator(`#table_option tr[rec_id="${map.markerId}"] td.edit`).click();
    await expect(form.locator('#name')).toHaveValue(name);
    for (const key of ['lat', 'lon'] as const) await expect(form.locator(`#${key}`)).toHaveValue(String(moved[key]));
    await form.locator('#form_cancel').click();
    await checkMarker(moved);
    expect(await markerHit(page, map.markerId, project(initial))).toBeNull();
    expect(await pixels(page, project(initial))).not.toContainEqual([255, 0, 0, 255]);
  });
  await test.step('Удалить маркер и сохранить карту', async () => {
    const deletedId = map.markerId;
    await removeMarker(page, map);
    await openMap(page, map);
    await expect(page.locator(`#legend_table tr[rec_id="${deletedId}"]`)).toHaveCount(0);
    const markerAbsent = () => page.evaluate(id => {
      const map = (window as MapWindow).os!.maps!.init!.data!.pointer!.map!;
      return map.getLayers().getArray().every(layer => !(layer.getSource().getFeatures?.() || []).some(feature => feature.get('id') === id));
    }, deletedId);
    await expect.poll(markerAbsent).toBe(true);
    await expect.poll(async () => (await pixels(page)).some(color => color[3] === 255)).toBe(true);
    // Окно наблюдения за повторным появлением после подгрузки, не SLA.
    await page.waitForTimeout(2000);
    expect(await markerAbsent()).toBe(true);
    for (const location of [initial, moved]) {
      const coordinate = project(location);
      expect(await markerHit(page, deletedId, coordinate)).toBeNull();
      expect(await pixels(page, coordinate)).not.toContainEqual([255, 0, 0, 255]);
    }
    await openViewList(page, 'Карты');
    await expect(viewRow(page, map.name)).toHaveAttribute('rec_id', map.id);
  });
});

test('Движение маркера по координатам из тегов', { tag: ['@map', '@map05', '@base'] }, async ({ page, context, onCleanup }, info) => {
  test.setTimeout(90_000);
  const deviceName = 'Координаты транспорта';
  const names = ['Широта', 'Долгота'];
  const initial = { lat: 55.75, lon: 37.62 };
  let writer: Page | undefined;

  await test.step('Создать теги широты и долготы', async () => {
    await createMapDevice(page, onCleanup, deviceName);
    await openDeviceTags(page, deviceName);
    for (const [index, name] of names.entries()) {
      const tag = await ensureVirtualTag(page, { id: index + 2, name, type: 'Float' });
      await expect(tag.locator('td[id^="v"]')).toHaveText('0');
      await setTagValue(page, name, index ? initial.lon : initial.lat);
    }
  });

  const map = await createMap(page, onCleanup, info, 'Движение транспорта', { ...initial, zoom: 12 });
  map.markerName = 'Сервисная машина';
  onCleanup(async () => {
    if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('Динамический маркер перед очисткой.png'), timeout: 3000 }).catch(() => {});
    if (await page.locator('#form_edit2').isVisible()) await page.locator('#form_edit2 .header > .close_form').click();
    await writer?.close();
  });
  await test.step('Привязать координаты маркера к тегам', async () => {
    await openObjects(page, map);
    await page.locator('#header_main .btn_add[onclick="os.maps.objects.edit(\'\')"]').click();
    const form = page.locator('#form_edit_map_objects');
    await form.locator('#name').fill(map.markerName);
    for (const [index, key] of ['lat', 'lon'].entries()) {
      await form.locator(`#${key}`).fill(String(index ? initial.lon : initial.lat));
      await chooseTag(page, form.locator(`#${key}_tag_path`).locator('..'), deviceName, names[index]);
    }
    await form.locator('#color').click();
    await page.locator('#color_dialog_lite .QuickColor[title="#ff0000ff"]').click();
    await page.locator('#color_dialog_lite input.Ok').click();
    const created = page.waitForResponse(r => new URL(r.url()).pathname === '/save_map_object//' && r.request().method() === 'POST', { timeout: 10_000 });
    await form.locator('#form_ok').click();
    const response = await created;
    const result = await response.json();
    map.markerId = claimId(result.object_id, map.knownIds);
    expect(response.ok()).toBe(true);
    expect(result.error).toBeFalsy();
    rememberCreated(page, map.markerId);
    await openObjects(page, map);
    await page.locator(`#table_option tr[rec_id="${map.markerId}"] td.edit`).click();
    for (const [index, key] of ['lat', 'lon'].entries()) {
      await expect(form.locator(`#${key}_tag_path`)).toHaveValue(`${deviceName}//${names[index]}`);
    }
    await form.locator('#form_cancel').click();
  });

  const checkPosition = async (location: typeof initial) => {
    const coordinate = project(location);
    await expect.poll(async () => {
      const hit = await markerHit(page, map.markerId, coordinate);
      return !!hit && hit.every((value, i) => Math.abs(value - coordinate[i]) < 1);
    }, { timeout: 15_000 }).toBe(true);
    await expect.poll(() => pixels(page, coordinate)).toContainEqual([255, 0, 0, 255]);
  };
  await openMap(page, map);
  await checkPosition(initial);
  writer = await context.newPage();
  await writer.goto('/');
  await openProject(writer, projectName);
  await openTree(writer);
  await openDeviceTags(writer, deviceName);
  for (const [index, name] of names.entries()) {
    await expect.poll(async () => Number(await writer!.locator('#table_option tr[rec_id]').filter({ has: writer!.getByRole('cell', { name, exact: true }) }).locator('td[id^="v"]').textContent())).toBe(index ? initial.lon : initial.lat);
  }
  let reopenings = 0;
  let navigations = 0;
  page.on('request', request => {
    if ([`/open_map/${map.id}/`, `/init_map/${map.id}/`].includes(new URL(request.url()).pathname)) reopenings++;
  });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  let previous = initial;
  for (const [index, location] of [{ lat: 55.76, lon: 37.62 }, { lat: 55.76, lon: 37.64 }].entries()) {
    await test.step(index ? 'Изменить долготу и увидеть движение' : 'Изменить широту и увидеть движение', async () => {
      await setTagValue(writer!, names[index], index ? location.lon : location.lat);
      await checkPosition(location);
      expect(await markerHit(page, map.markerId, project(previous))).toBeNull();
      expect(await pixels(page, project(previous))).not.toContainEqual([255, 0, 0, 255]);
      expect(reopenings, 'Карта обновляется без повторного открытия').toBe(0);
      expect(navigations, 'Карта обновляется без навигации').toBe(0);
      previous = location;
    });
  }
});

test('Цвет маркера из тега', { tag: ['@map', '@map06', '@base'] }, async ({ page, context, onCleanup }, info) => {
  test.setTimeout(90_000);
  const deviceName = 'Состояние транспорта';
  const tagName = 'Цвет машины';
  const location = { lat: 55.75, lon: 37.62, zoom: 12 };
  let writer: Page | undefined;
  await test.step('Создать тег цвета', async () => {
    await createMapDevice(page, onCleanup, deviceName);
    await openDeviceTags(page, deviceName);
    await expect(viewRow(page, tagName)).toHaveCount(0);
    await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить' }).click();
    const form = page.locator('#form_edit_tag');
    await form.locator('#adress').fill('2');
    await form.locator('#title').fill(tagName);
    await form.locator('#type_signal_tag').selectOption({ label: 'Virtual' });
    for (const id of ['format_value', 'format_value_out']) await form.locator(`#${id}`).selectOption({ label: 'Int' });
    await form.locator('#default_value').fill('0');
    await saveOwned(page, '/save_tag/', 'tag_id', () => form.locator('#form_ok').click());
    const row = viewRow(page, tagName);
    await expect(row.locator('td[id^="v"]')).toHaveText('0');
    await row.locator('td.edit').click();
    for (const id of ['format_value', 'format_value_out']) await expect(form.locator(`#${id} option:checked`)).toHaveText('Int');
    await form.locator('#form_cancel').click();
    await setTagValue(page, tagName, 16711680);
  });
  const map = await createMap(page, onCleanup, info, 'Состояние машин', location);
  map.markerName = 'Машина';
  onCleanup(async () => {
    if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('Цвет маркера перед очисткой.png'), timeout: 3000 }).catch(() => {});
    if (await page.locator('#form_edit2').isVisible()) await page.locator('#form_edit2 .header > .close_form').click();
    await writer?.close();
  });
  await test.step('Привязать цвет маркера к тегу', async () => {
    await openObjects(page, map);
    await page.locator('#header_main .btn_add[onclick="os.maps.objects.edit(\'\')"]').click();
    const form = page.locator('#form_edit_map_objects');
    await form.locator('#name').fill(map.markerName);
    await form.locator('#lat').fill(String(location.lat));
    await form.locator('#lon').fill(String(location.lon));
    await chooseTag(page, form.locator('#clr_tag_path').locator('..'), deviceName, tagName);
    const created = page.waitForResponse(r => new URL(r.url()).pathname === '/save_map_object//' && r.request().method() === 'POST', { timeout: 10_000 });
    await form.locator('#form_ok').click();
    const response = await created;
    const result = await response.json();
    map.markerId = claimId(result.object_id, map.knownIds);
    expect(response.ok()).toBe(true);
    expect(result.error).toBeFalsy();
    rememberCreated(page, map.markerId);
    await openObjects(page, map);
    await page.locator(`#table_option tr[rec_id="${map.markerId}"] td.edit`).click();
    await expect(form.locator('#clr_tag_path')).toHaveValue(`${deviceName}//${tagName}`);
    await form.locator('#form_cancel').click();
  });
  await openMap(page, map);
  if (await page.locator('#visible_panel_legend').isVisible()) await page.locator('#visible_panel_legend').click();
  const legend = page.locator(`#legend_table tr[rec_id="${map.markerId}"]`);
  await expect(legend).toBeVisible();
  await expect(legend).toContainText(map.markerName);
  const coordinate = project(location);
  const checkColor = async (rgb: number[]) => {
    await expect.poll(() => pixels(page, coordinate), { timeout: 15_000 }).toContainEqual([...rgb, 255]);
    await expect.poll(async () => {
      const hit = await markerHit(page, map.markerId, coordinate);
      return !!hit && hit.every((value, i) => Math.abs(value - coordinate[i]) < 1);
    }).toBe(true);
    const expected = `rgb(${rgb.join(', ')})`;
    // Мягкая проверка легенды позволяет проверить остальные цвета при её рассинхронизации.
    await expect.soft(legend.locator('p.marker_obj')).toHaveCSS('background-color', expected, { timeout: 15_000 });
    const actual = await legend.locator('p.marker_obj').evaluate(el => getComputedStyle(el).backgroundColor);
    await info.attach(`Цвет ${rgb.join('-')}`, { body: JSON.stringify({ rgb, value: 65536 * rgb[0] + 256 * rgb[1] + rgb[2], legend: actual, canvas: await pixels(page, coordinate) }), contentType: 'application/json' });
    if (actual !== expected) await page.screenshot({ path: info.outputPath(`Цвет ${rgb.join('-')}.png`) });
  };
  await test.step('Увидеть красный маркер', async () => {
    await checkColor([255, 0, 0]);
  });
  writer = await context.newPage();
  await writer.goto('/');
  await openProject(writer, projectName);
  await openTree(writer);
  await openDeviceTags(writer, deviceName);
  await expect(viewRow(writer, tagName).locator('td[id^="v"]')).toHaveText('16711680');
  let reopenings = 0;
  let navigations = 0;
  page.on('request', request => {
    if ([`/open_map/${map.id}/`, `/init_map/${map.id}/`].includes(new URL(request.url()).pathname)) reopenings++;
  });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  for (const [title, rgb] of [['Сменить цвет на синий', [0, 0, 255]], ['Сменить цвет на зелёный', [0, 255, 0]]] as const) {
    await test.step(title, async () => {
      const value = 65536 * rgb[0] + 256 * rgb[1] + rgb[2];
      await setTagValue(writer!, tagName, value);
      await checkColor([...rgb]);
      expect(reopenings, 'Цвет обновляется без повторного открытия карты').toBe(0);
      expect(navigations, 'Цвет обновляется без навигации').toBe(0);
    });
  }
});

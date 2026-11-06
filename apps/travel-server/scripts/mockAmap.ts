/**
 * 本地 mock 高德 Web 服务。
 *
 * 让 offline 冒烟和 HTTP E2E 都能在不消耗真实配额的情况下跑通工具链：
 * 覆盖 geocode / district / place(text|around|detail) / weather / direction 六类端点。
 *
 * 单独启动：npx tsx scripts/mockAmap.ts 4010
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface MockPoi {
  id: string
  name: string
  type: string
  typecode: string
  address: string
  location: string
  rating: string
  cost: string
  openTime: string
}

export const MOCK_POIS: MockPoi[] = [
  { id: 'B0FFH1', name: '宽窄巷子', type: '风景名胜;特色街区', typecode: '110200', address: '长顺上街', location: '104.057,30.669', rating: '4.6', cost: '0', openTime: '全天' },
  { id: 'B0FFH2', name: '人民公园', type: '风景名胜;公园', typecode: '110101', address: '少城路 12 号', location: '104.061,30.663', rating: '4.5', cost: '0', openTime: '06:00-22:00' },
  { id: 'B0FFH3', name: '武侯祠博物馆', type: '科教文化服务;博物馆', typecode: '140100', address: '武侯祠大街 231 号', location: '104.048,30.645', rating: '4.7', cost: '50', openTime: '08:00-20:00' },
  { id: 'B0FFH4', name: '锦里古街', type: '风景名胜;特色街区', typecode: '110200', address: '武侯祠大街 231 号附 1', location: '104.047,30.643', rating: '4.4', cost: '0', openTime: '全天' },
  { id: 'B0FFH5', name: '成都博物馆', type: '科教文化服务;博物馆', typecode: '140100', address: '小河街 1 号', location: '104.063,30.657', rating: '4.8', cost: '0', openTime: '09:00-20:00' },
  { id: 'B0FFH6', name: '春熙路', type: '购物服务;商业街', typecode: '060100', address: '春熙路', location: '104.081,30.657', rating: '4.3', cost: '0', openTime: '全天' },
]

function poiPayload(poi: MockPoi) {
  return {
    id: poi.id,
    name: poi.name,
    type: poi.type,
    typecode: poi.typecode,
    address: poi.address,
    location: poi.location,
    tel: '028-88888888',
    biz_ext: [{ rating: poi.rating, cost: poi.cost, open_time: poi.openTime }],
  }
}

function castDates(): string[] {
  const today = new Date()
  return [0, 1, 2, 3].map((offset) => {
    const date = new Date(today)
    date.setUTCDate(date.getUTCDate() + offset)
    return date.toISOString().slice(0, 10)
  })
}

export function mockAmapRoute(path: string, query: URLSearchParams): unknown {
  if (path === '/v3/geocode/geo') {
    return {
      status: '1',
      info: 'OK',
      geocodes: [
        {
          formatted_address: '四川省成都市',
          city: '成都市',
          adcode: '510100',
          location: '104.066541,30.572269',
          level: '市',
        },
      ],
    }
  }
  if (path === '/v3/config/district') {
    return {
      status: '1',
      info: 'OK',
      districts: [{ name: '成都市', districts: [{ name: '锦江区' }, { name: '青羊区' }, { name: '武侯区' }] }],
    }
  }
  if (path === '/v3/place/text' || path === '/v3/place/around') {
    const keywords = query.get('keywords') ?? ''
    const matched = MOCK_POIS.filter(
      (poi) => keywords === '' || poi.name.includes(keywords) || poi.type.includes(keywords),
    )
    const list = (matched.length ? matched : MOCK_POIS).slice(0, Number(query.get('offset') ?? 8))
    return { status: '1', info: 'OK', count: String(list.length), pois: list.map(poiPayload) }
  }
  if (path === '/v3/place/detail') {
    const poi = MOCK_POIS.find((item) => item.id === query.get('id'))
    return { status: '1', info: 'OK', pois: poi ? [poiPayload(poi)] : [] }
  }
  if (path === '/v3/weather/weatherInfo') {
    return {
      status: '1',
      info: 'OK',
      forecasts: [
        {
          city: '成都市',
          casts: castDates().map((date) => ({
            date,
            dayweather: '多云',
            nightweather: '阴',
            daytemp: '24',
            nighttemp: '15',
            daywind: '北',
            daypower: '1-3',
          })),
        },
      ],
    }
  }
  if (path.startsWith('/v3/direction/')) {
    return {
      status: '1',
      info: 'OK',
      route: {
        paths: [{ distance: '1800', duration: '900', steps: [{ instruction: '步行约 15 分钟' }] }],
        transits: [{ distance: '4200', duration: '1500', segments: [] }],
      },
    }
  }
  return { status: '0', info: 'UNKNOWN_PATH', infocode: '00000' }
}

export function createMockAmapServer(): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const payload = mockAmapRoute(url.pathname, url.searchParams)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  })
}

export async function startMockAmap(port = 0): Promise<{ server: Server; baseUrl: string }> {
  const server = createMockAmapServer()
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const actual = (server.address() as AddressInfo).port
  return { server, baseUrl: `http://127.0.0.1:${actual}` }
}

// 直接执行时作为一个常驻服务跑起来，供 HTTP E2E 使用
if (process.argv[1]?.includes('mockAmap')) {
  const port = Number(process.argv[2]) || 4010
  startMockAmap(port).then(({ baseUrl }) => {
    console.log(`mock 高德已启动：${baseUrl}`)
  })
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { UnauthorizedError, fetchCameras, fetchConfig, saveConfig } from './api'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const fetchMock = vi.fn()

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe('fetchConfig', () => {
  it('sends the x-tapo-token header when a token is set', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse({ cameras: [] }))

    await fetchConfig('secret')

    expect(fetchMock).toHaveBeenCalledWith('/api/config', {
      headers: { 'x-tapo-token': 'secret' },
    })
  })

  it('sends no auth header when no token is set', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse({ cameras: [] }))

    await fetchConfig()

    expect(fetchMock).toHaveBeenCalledWith('/api/config', { headers: {} })
  })

  it('throws UnauthorizedError on 401', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401))

    await expect(fetchConfig('wrong')).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

describe('saveConfig', () => {
  it('PUTs the patch with the token header', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, warnings: [] }))

    await saveConfig({ cameras: [] }, 'secret')

    expect(fetchMock).toHaveBeenCalledWith('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-tapo-token': 'secret' },
      body: JSON.stringify({ cameras: [] }),
    })
  })

  it('throws UnauthorizedError on 401', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401))

    await expect(saveConfig({ cameras: [] })).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('surfaces the server error message on non-ok', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'duplicate camera id' }, 422))

    await expect(saveConfig({ cameras: [] })).rejects.toThrow('duplicate camera id')
  })
})

describe('fetchCameras', () => {
  it('returns the cameras array', async () => {
    vi.stubGlobal('fetch', fetchMock)
    const cameras = [{ id: 'a', name: 'A' }]
    fetchMock.mockResolvedValueOnce(jsonResponse({ cameras }))

    await expect(fetchCameras()).resolves.toEqual(cameras)
  })
})

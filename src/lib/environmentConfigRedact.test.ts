import { describe, expect, it } from 'vitest'
import { redactEnvironmentConfig } from './environmentConfigRedact'

describe('redactEnvironmentConfig', () => {
  it('masks sensitive keys at any depth', () => {
    const input = {
      host: 'splunk.example.com',
      password: 'hunter2',
      nested: { apiKey: 'abc123', port: 8088 },
    }
    const out = redactEnvironmentConfig(input)
    expect(out.host).toBe('splunk.example.com')
    expect(out.password).toBe('••••••••')
    expect((out.nested as Record<string, unknown>).apiKey).toBe('••••••••')
    expect((out.nested as Record<string, unknown>).port).toBe(8088)
  })

  it('preserves non-sensitive fields', () => {
    const input = { type: 'syslog', port: 514, description: 'Main feed' }
    expect(redactEnvironmentConfig(input)).toEqual(input)
  })
})

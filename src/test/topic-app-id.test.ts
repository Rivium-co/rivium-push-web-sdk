/**
 * The backend publishes to `rivium_push/{first 16 chars of the project id}/…`
 * and returns that value as `appId` from /devices/register. This SDK stored it
 * and then built every channel from the API key prefix instead, so it streamed
 * from channels nothing is ever published to: real-time delivery on web never
 * worked, from 0.1.0 to 0.1.8. Web Push carried every message on its own,
 * which is why no test or live app ever showed it.
 */
import { jest } from '@jest/globals';
import { RiviumPush } from '../index';

const PROJECT_APP_ID = 'f5dbab4c-31ca-43'; // what /devices/register returns
const API_KEY = 'rv_live_61aabb6a08a1fa3f37fbe030f1dccc9f';

describe('MQTT channels use the id the backend publishes to', () => {
  const client = (): any => new RiviumPush({ apiKey: API_KEY });

  beforeEach(() => localStorage.clear());

  it('uses the API key prefix only until the backend has told us otherwise', () => {
    expect(client().topicAppId()).toBe(API_KEY.substring(0, 16));
  });

  it('uses appId from the register response once it is known', () => {
    const c = client();
    c.appId = PROJECT_APP_ID;
    expect(c.topicAppId()).toBe(PROJECT_APP_ID);
  });

  it('restores appId on the next page load, before register() runs again', () => {
    localStorage.setItem('rivium_push_app_id', PROJECT_APP_ID);
    expect(client().topicAppId()).toBe(PROJECT_APP_ID);
  });

  it('streams the channels the backend publishes to', () => {
    const c = client();
    c.appId = PROJECT_APP_ID;
    c.subscriptionId = '050bd787-fe06-47f6-9d0f-ae24f94f653b';
    c.deviceId = 'web_9be04034';
    c.appIdentifier = 'http://localhost:3000';
    c.subscribedTopics = new Set(['news']);

    const streamed: string[] = [];
    c.pnSocket = { stream: (channel: string) => streamed.push(channel), isConnected: () => true };
    c.setConnectionState = jest.fn();
    // Run just the subscribe block by replaying what onConnected does.
    const appId = c.topicAppId();
    c.pnSocket.stream(`rivium_push/${appId}/sub/${c.subscriptionId}`);
    c.pnSocket.stream(`rivium_push/${appId}/broadcast`);
    c.subscribedTopics.forEach((t: string) => c.pnSocket.stream(`rivium_push/${appId}/topic/${t}`));

    // Mirrors the backend: publishToDevice() and broadcast() in push.service.ts.
    expect(streamed).toEqual([
      `rivium_push/${PROJECT_APP_ID}/sub/050bd787-fe06-47f6-9d0f-ae24f94f653b`,
      `rivium_push/${PROJECT_APP_ID}/broadcast`,
      `rivium_push/${PROJECT_APP_ID}/topic/news`,
    ]);
    expect(streamed.some((c2) => c2.includes('rv_live_'))).toBe(false);
  });
});

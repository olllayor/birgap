import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  describe('getDevicesWithSockets', () => {
    const makeService = (pipeline: { scard: jest.Mock; exec: jest.Mock }) => {
      const client = {
        status: 'ready',
        pipeline: jest.fn().mockReturnValue(pipeline),
      };
      const config = { getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379') } as unknown as ConfigService;
      const service = new RedisService(config);
      (service as unknown as { client: typeof client }).client = client;
      return service;
    };

    it('returns an empty set when given no device ids', async () => {
      const service = makeService({ scard: jest.fn(), exec: jest.fn() });
      const result = await service.getDevicesWithSockets([]);
      expect(result.size).toBe(0);
    });

    it('returns only the ids whose socket set is non-empty', async () => {
      const exec = jest.fn().mockResolvedValue([
        [null, 0],
        [null, 2],
        [null, 1],
        [null, 0],
      ]);
      const pipeline = { scard: jest.fn(), exec };
      const service = makeService(pipeline);

      const result = await service.getDevicesWithSockets(['d-1', 'd-2', 'd-3', 'd-4']);

      expect(pipeline.scard).toHaveBeenCalledTimes(4);
      expect(pipeline.scard).toHaveBeenNthCalledWith(1, 'device:d-1:sockets');
      expect(pipeline.scard).toHaveBeenNthCalledWith(2, 'device:d-2:sockets');
      expect(pipeline.scard).toHaveBeenNthCalledWith(3, 'device:d-3:sockets');
      expect(pipeline.scard).toHaveBeenNthCalledWith(4, 'device:d-4:sockets');
      expect(Array.from(result)).toEqual(['d-2', 'd-3']);
    });

    it('rejects when the pipeline rejects (caller is expected to catch)', async () => {
      const exec = jest.fn().mockRejectedValue(new Error('redis down'));
      const pipeline = { scard: jest.fn(), exec };
      const service = makeService(pipeline);

      await expect(service.getDevicesWithSockets(['d-1'])).rejects.toThrow('redis down');
    });

    it('skips entries with per-command errors', async () => {
      const exec = jest.fn().mockResolvedValue([
        [new Error('boom'), 0],
        [null, 5],
      ]);
      const pipeline = { scard: jest.fn(), exec };
      const service = makeService(pipeline);

      const result = await service.getDevicesWithSockets(['d-1', 'd-2']);

      expect(Array.from(result)).toEqual(['d-2']);
    });
  });
});

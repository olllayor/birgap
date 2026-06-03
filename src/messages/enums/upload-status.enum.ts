import { registerEnumType } from '@nestjs/graphql';

export enum UploadStatus {
  PENDING = 'PENDING',
  COMPLETE = 'COMPLETE',
  FAILED = 'FAILED',
}

registerEnumType(UploadStatus, {
  name: 'UploadStatus',
  description: 'Upload status of a media attachment',
});

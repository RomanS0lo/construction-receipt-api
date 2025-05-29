declare module 'multer-s3' {
  import { S3 } from 'aws-sdk';
  import { StorageEngine } from 'multer';

  namespace multerS3 {
    interface Options {
      s3: S3;
      bucket: string | ((req: Express.Request, file: Express.Multer.File, callback: (error: any, bucket?: string) => void) => void);
      key?: (req: Express.Request, file: Express.Multer.File, callback: (error: any, key?: string) => void) => void;
      acl?: string | ((req: Express.Request, file: Express.Multer.File, callback: (error: any, acl?: string) => void) => void);
      contentType?: ((req: Express.Request, file: Express.Multer.File, callback: (error: any, mime?: string, stream?: NodeJS.ReadableStream) => void) => void);
      contentDisposition?: string | ((req: Express.Request, file: Express.Multer.File, callback: (error: any, contentDisposition?: string) => void) => void);
      metadata?: (req: Express.Request, file: Express.Multer.File, callback: (error: any, metadata?: any) => void) => void;
      cacheControl?: string | ((req: Express.Request, file: Express.Multer.File, callback: (error: any, cacheControl?: string) => void) => void);
      serverSideEncryption?: string | ((req: Express.Request, file: Express.Multer.File, callback: (error: any, serverSideEncryption?: string) => void) => void);
    }

    interface S3Storage extends StorageEngine {
      AUTO_CONTENT_TYPE: (req: Express.Request, file: Express.Multer.File, callback: (error: any, mime?: string, stream?: NodeJS.ReadableStream) => void) => void;
    }
  }

  function multerS3(options: multerS3.Options): multerS3.S3Storage;
  
  export = multerS3;
}

declare namespace Express {
  namespace MulterS3 {
    interface File extends Multer.File {
      bucket: string;
      key: string;
      acl: string;
      contentType: string;
      contentDisposition: string;
      storageClass: string;
      serverSideEncryption: string;
      metadata: any;
      location: string;
      etag: string;
      size: number;
    }
  }
}
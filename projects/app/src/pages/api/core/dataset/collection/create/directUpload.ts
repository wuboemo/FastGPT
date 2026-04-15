import type { NextApiRequest, NextApiResponse } from 'next';
import { readFile } from 'node:fs/promises';
import { NextAPI } from '@/service/middleware/entry';
import { getUploadModel } from '@fastgpt/service/common/file/multer';
import { removeFilesByPaths } from '@fastgpt/service/common/file/utils';
import { authDataset } from '@fastgpt/service/support/permission/dataset/auth';
import { WritePermissionVal } from '@fastgpt/global/support/permission/constant';
import { getS3DatasetSource } from '@fastgpt/service/common/s3/sources/dataset';
import { createCollectionAndInsertData } from '@fastgpt/service/core/dataset/collection/controller';
import { DatasetCollectionTypeEnum } from '@fastgpt/global/core/dataset/constants';
import type { FileCreateDatasetCollectionParams } from '@fastgpt/global/core/dataset/api';

type DirectUploadBody = Omit<FileCreateDatasetCollectionParams, 'fileMetadata'> & {
  name?: string;
};

type DirectUploadResponse = Promise<{
  collectionId: string;
  fileId: string;
  filename: string;
  results: {
    insertLen: number;
  };
}>;

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<any>
): DirectUploadResponse {
  const filePaths: string[] = [];

  try {
    const upload = getUploadModel({
      maxSize: global.feConfigs?.uploadFileMaxSize
    });
    const { file, data } = await upload.getUploadFile<DirectUploadBody>(req, res);
    filePaths.push(file.path);

    if (!file) {
      return Promise.reject(new Error('file is empty'));
    }

    const { teamId, tmbId, dataset } = await authDataset({
      req,
      authToken: true,
      authApiKey: true,
      per: WritePermissionVal,
      datasetId: data.datasetId
    });

    const fileBuffer = await readFile(file.path);
    const fileId = await getS3DatasetSource().uploadDatasetFileByBuffer({
      datasetId: data.datasetId,
      buffer: fileBuffer,
      filename: file.originalname
    });

    removeFilesByPaths(filePaths);

    const { collectionMetadata, name, ...collectionData } = data;
    const { collectionId, insertResults } = await createCollectionAndInsertData({
      dataset,
      createCollectionParams: {
        ...collectionData,
        datasetId: data.datasetId,
        teamId,
        tmbId,
        type: DatasetCollectionTypeEnum.file,
        name: name || file.originalname,
        fileId,
        metadata: {
          ...collectionMetadata,
          relatedImgId: fileId
        }
      }
    });

    return {
      collectionId,
      fileId,
      filename: file.originalname,
      results: insertResults
    };
  } catch (error) {
    removeFilesByPaths(filePaths);
    return Promise.reject(error);
  }
}

export const config = {
  api: {
    bodyParser: false
  }
};

export default NextAPI(handler);

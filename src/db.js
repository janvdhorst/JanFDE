import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const region = process.env.AWS_REGION || "us-east-1";
const client = new DynamoDBClient({ region });
const db = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

export const LOADS_TABLE = process.env.DYNAMODB_LOADS_TABLE || "happyrobot-api-loads";
export const OFFERS_TABLE = process.env.DYNAMODB_OFFERS_TABLE || "happyrobot-api-offers";

export default db;

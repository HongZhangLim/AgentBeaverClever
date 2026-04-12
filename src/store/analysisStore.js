import crypto from "crypto";

const analysisMap = new Map();

export function saveAnalysis(payload) {
  const analysisId = crypto.randomUUID();
  analysisMap.set(analysisId, {
    ...payload,
    createdAt: new Date().toISOString(),
  });
  return analysisId;
}

export function getAnalysis(analysisId) {
  return analysisMap.get(analysisId);
}

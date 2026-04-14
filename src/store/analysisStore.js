import crypto from "crypto";

const analysisMap = new Map();
let latestAnalysisId = null;

export function saveAnalysis(payload) {
  const analysisId = crypto.randomUUID();
  analysisMap.set(analysisId, {
    ...payload,
    createdAt: new Date().toISOString(),
  });
  latestAnalysisId = analysisId;
  return analysisId;
}

export function getAnalysis(analysisId) {
  return analysisMap.get(analysisId);
}

export function getLatestAnalysis() {
  if (!latestAnalysisId) {
    return null;
  }

  const analysis = analysisMap.get(latestAnalysisId);
  if (!analysis) {
    return null;
  }

  return {
    analysisId: latestAnalysisId,
    ...analysis,
  };
}

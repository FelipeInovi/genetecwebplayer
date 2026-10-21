import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import env from "@/render/config/env";
import config from "@/render/config/poc.config";
import {
  GenetecForbiddenError,
  TokenExpiredError
} from "@/render/service/errors";

/** localStorage.accessToken wins; VITE_DEV_BEARER_TOKEN is the POC fallback. */
export const resolveToken = (): string | null => {
  const stored = localStorage.getItem("accessToken");
  if (stored) return stored;
  return env.VITE_DEV_BEARER_TOKEN || null;
};

const onRequest = (
  request: InternalAxiosRequestConfig
): InternalAxiosRequestConfig => {
  const token = resolveToken();
  if (token && request.headers) {
    request.headers.Authorization = `Bearer ${token}`;
  }
  return request;
};

// Unlike the target app, a 401 must NOT wipe storage: just surface a typed error.
const onResponseError = (error: AxiosError): Promise<never> => {
  const status = error.response?.status;
  if (status === 401) return Promise.reject(new TokenExpiredError());
  if (status === 403) return Promise.reject(new GenetecForbiddenError());
  return Promise.reject(error);
};

const apiLV = axios.create({
  baseURL: `${config.apiURL}/api`,
  withCredentials: true
});

apiLV.interceptors.request.use(onRequest);
apiLV.interceptors.response.use((response) => response, onResponseError);

export default apiLV;

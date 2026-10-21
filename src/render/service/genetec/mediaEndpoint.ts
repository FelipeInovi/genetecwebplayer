const MEDIA_PATH = "/media";

/**
 * Config holds the Media Gateway base URL (https://host:port). GWP wants the
 * application path (<base>/media) both for the script URL
 * (`${endpoint}/v2/files/gwp.js`) and for start()/buildMediaGatewayService().
 */
export const getMediaEndpoint = (baseUrl: string): string => {
  const base = baseUrl.replace(/\/+$/, "");
  return base.endsWith(MEDIA_PATH) ? base : `${base}${MEDIA_PATH}`;
};

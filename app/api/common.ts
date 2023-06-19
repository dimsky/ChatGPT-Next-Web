import { NextRequest, NextResponse } from "next/server";

export const OPENAI_URL = "api.openai.com";
const DEFAULT_PROTOCOL = "https";
const PROTOCOL = process.env.PROTOCOL ?? DEFAULT_PROTOCOL;
const BASE_URL = process.env.BASE_URL ?? OPENAI_URL;
const DISABLE_GPT4 = !!process.env.DISABLE_GPT4;
const XAI_API_TOKEN = process.env.XAI_API_TOKEN ?? "";
const XAI_API_HOST = process.env.XAI_API_HOST ?? "";

export async function requestOpenai(req: NextRequest) {
  const controller = new AbortController();
  const authValue = req.headers.get("Authorization") ?? "";
  const openaiPath = `${req.nextUrl.pathname}${req.nextUrl.search}`.replaceAll(
    "/api/openai/",
    "",
  );

  let baseUrl = BASE_URL;

  if (!baseUrl.startsWith("http")) {
    baseUrl = `${PROTOCOL}://${baseUrl}`;
  }

  console.log("[Proxy] ", openaiPath);
  console.log("[Base Url]", baseUrl);

  if (process.env.OPENAI_ORG_ID) {
    console.log("[Org ID]", process.env.OPENAI_ORG_ID);
  }

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 10 * 60 * 1000);

  const fetchUrl = `${baseUrl}/${openaiPath}`;
  const fetchOptions: RequestInit = {
    headers: {
      "Content-Type": "application/json",
      Authorization: authValue,
      ...(process.env.OPENAI_ORG_ID && {
        "OpenAI-Organization": process.env.OPENAI_ORG_ID,
      }),
    },
    cache: "no-store",
    method: req.method,
    body: req.body,
    signal: controller.signal,
  };
  const clonedBody = await req.text();
  fetchOptions.body = clonedBody;

  console.log("[Test Body]", clonedBody);
  if (clonedBody && clonedBody !== "") {
    const jsonBody = JSON.parse(clonedBody);
    if (jsonBody.model === "gpt-4") {
      let customOptions: RequestInit = {
        headers: {
          "Content-Type": "application/json",
          "x-token": XAI_API_TOKEN,
        },
        body: fetchOptions.body,
        method: req.method,
        cache: "no-store",
      };

      console.log("[GPT-4]", customOptions);
      try {
        const res = await fetch(
          `${XAI_API_HOST}ai/completions/gpt-4`,
          customOptions,
        );
        const newHeaders = new Headers(res.headers);
        newHeaders.delete("www-authenticate");
        // to disbale ngnix buffering
        newHeaders.set("X-Accel-Buffering", "no");

        console.log(
          "[GPT-4 response]",
          res.body,
          res.status,
          res.statusText,
          newHeaders,
          `${XAI_API_HOST}ai/completions/gpt-4`,
        );
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers: newHeaders,
        });
      } catch (e) {
        console.log("[Fetch Error]", e);
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  // #1815 try to refuse gpt4 request
  if (DISABLE_GPT4 && req.body) {
    try {
      const clonedBody = await req.text();
      fetchOptions.body = clonedBody;

      const jsonBody = JSON.parse(clonedBody);

      if ((jsonBody?.model ?? "").includes("gpt-4")) {
        return NextResponse.json(
          {
            error: true,
            message: "you are not allowed to use gpt-4 model",
          },
          {
            status: 403,
          },
        );
      }
    } catch (e) {
      console.error("[OpenAI] gpt4 filter", e);
    }
  }

  try {
    const res = await fetch(fetchUrl, fetchOptions);

    // to prevent browser prompt for credentials
    const newHeaders = new Headers(res.headers);
    newHeaders.delete("www-authenticate");

    // to disbale ngnix buffering
    newHeaders.set("X-Accel-Buffering", "no");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

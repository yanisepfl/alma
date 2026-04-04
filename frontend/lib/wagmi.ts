import { http, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const config = createConfig({
  chains: [base],
  connectors: [injected()],
  transports: {
    [base.id]: http("https://lb.drpc.live/base/ApzzZ4_VREdElCiRmvIW2zKdznVRMDYR8aEIGrar0DFx"),
  },
  ssr: true,
});

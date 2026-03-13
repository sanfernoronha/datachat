// __fixtures__/messages.ts
//
// Reusable test data for notebook export tests.

import type { DbMessage } from "@/lib/export/notebook";

export const EMPTY_MESSAGES: DbMessage[] = [];

export const USER_ONLY_MESSAGES: DbMessage[] = [
  { role: "user", content: "Describe the dataset", metadata: null },
  { role: "user", content: "Show me the columns", metadata: null },
];

export const CODE_EXECUTION_MESSAGES: DbMessage[] = [
  {
    role: "user",
    content: "Describe the dataset",
    metadata: null,
  },
  {
    role: "assistant",
    content: "Here is the analysis.",
    metadata: {
      tools: [
        {
          toolName: "execute_python",
          input: { code: "import pandas as pd\ndf = pd.read_csv('data.csv')\nprint(df.describe())" },
          output: {
            status: "ok",
            stdout: "       col1   col2\nmean   1.5    2.5\n",
            stderr: "",
          },
        },
      ],
    },
  },
];

export const INSTALL_MESSAGES: DbMessage[] = [
  {
    role: "assistant",
    content: "Installing seaborn.",
    metadata: {
      tools: [
        {
          toolName: "install_package",
          input: { package: "seaborn" },
          output: { status: "ok", stdout: "Successfully installed seaborn" },
        },
      ],
    },
  },
];

export const PLOT_MESSAGES: DbMessage[] = [
  {
    role: "assistant",
    content: "Here is the plot.",
    metadata: {
      tools: [
        {
          toolName: "execute_python",
          input: { code: "import matplotlib.pyplot as plt\nplt.plot([1,2,3])\nplt.show()" },
          output: {
            status: "ok",
            stdout: "",
            stderr: "",
            plot_filenames: ["abc123.png"],
          },
        },
      ],
    },
  },
];

export const ERROR_MESSAGES: DbMessage[] = [
  {
    role: "assistant",
    content: "There was an error.",
    metadata: {
      tools: [
        {
          toolName: "execute_python",
          input: { code: "1/0" },
          output: {
            status: "error",
            stdout: "",
            stderr: "",
            error: "ZeroDivisionError: division by zero",
          },
        },
      ],
    },
  },
];

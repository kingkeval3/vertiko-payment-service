//firebase-functions-documentation
//https://firebase.google.com/docs/functions/get-started

//required imports
require("dotenv").config();
const { firestore } = require("firebase-admin");
const admin = require("firebase-admin");
const functions = require("firebase-functions");
var serviceAccount = require("./vertiko-3fe1a-firebase-adminsdk-39mqt-5b3edf22f0.json");
const Razorpay = require("razorpay");
const cors = require("cors")({ origin: true });

//server-configurations
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const razorpayInstance = new Razorpay({
  //API_KEY
  key_id: process.env.RAZORPAY_API_KEY,

  //SECRET_KEY
  key_secret: process.env.RAZORPAY_API_SECRET,
});

//Constants

//Firestore Constants
const firestoreAdmin = admin.firestore();

//Users Collection Constants
const usersCollectionName = "users";
const usersCollectionEmailField = "email";
const usersCollectionPhoneField = "phone";
const usersCollectionUserIdField = "uid";
const usersCollectionSubscriptionField = "subscriptionDetails";
const userCollectionSubscriptionDetailsShortUrlField = "short_url";
const userCollectionSubscriptionDetailsPlanIdField = "plan_id";
const userCollectionSubscriptionDetailsStatusField = "status";
const usersCollectionSubscriptionEnabledField = "subscriptionEnabled";
const usersCollectionSubscriptionDetailsIdField = "id";
const usersCollectionSubscriptionCancelDetailsField =
  "subscriptionCancelRequestDetails";
const usersCollectionSubscriptionIdField = "subscriptionId";
const usersCollectionSubscriptionAddOnHistoryField =
  "subscriptionAddOnsHistory";

//Razorpay Subscription Constants
const subscriptionStatusActive = "activated";
const subscriptionStatusAuthenticated = "authenticated";
const subscriptionStatusCharged = "charged";
const subscriptionStatusCompleted = "completed";
const subscriptionStatusUpdated = "updated";
const subscriptionStatusPending = "pending";
const subscriptionStatusHalted = "halted";
const subscriptionStatusPaused = "paused";
const subscriptionStatusResumed = "resumed";
const subscriptionStatusCreated = "created";
const subscriptionStatusCancelled = "cancelled";
const orderStatusPaid = "paid";
const subscriptionScheduleChangeAtNow = "now";
const subscriptionScheduleChangeAtCycleEnd = "cycle_end";
const razorpayErrorResponseKey = "error";

//APIs----------------------------------------------------
/**
 * API to create or update subscription for users
 * create subscription and send payment url back
 * if subscription already exists which is not in any of active stages then subscription update is attempted for user, url sent back
 * NOTE:
 * Request Params required in URL - userId and planType (1,2)
 * /createUpdateSubscription?userId=4tID2qzCVePJ3tpL0wUw92TghLe2&planType=1
 *
 * RESPONSE:
 * expect json object with just the key 'subscriptionUrl' , use url in value to redirect user to payment gateway of razor-pay
 * in case of error expect status codes other than 200
 */
exports.createUpdateSubscription = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      //validate user email and planType passed in query param
      //query parameter constants
      const userIdQueryParamKey = "userId";
      const planTypeQueryParamKey = "planType";
      const expectedPlanTypeInput = [1, 2];

      if (
        !req.query.hasOwnProperty(userIdQueryParamKey) &&
        isNullOrEmptyUtil(req.query[userIdQueryParamKey]) &&
        !req.query.hasOwnProperty(planTypeQueryParamKey) &&
        isNullOrEmptyUtil(req.query[planTypeQueryParamKey]) &&
        expectedPlanTypeInput.includes(req.query[planTypeQueryParamKey])
      ) {
        res
          .status(400)
          .send("Bad Request - please pass valid user id and/or plan type");
      }

      //query param values
      let userId = req.query[userIdQueryParamKey];
      let userPlanIdSelected =
        req.query[planTypeQueryParamKey] == 1
          ? process.env.RAZORPAY_SERVICE1_PLAN_ID
          : process.env.RAZORPAY_SERVICE2_PLAN_ID;

      //fetch user by id
      const user = await firestoreAdmin
        .collection(usersCollectionName)
        .where(usersCollectionUserIdField, "==", userId)
        .limit(1)
        .get();

      //validate if user exists by such email
      if (checkIfArrayNullOrEmpty(user.docs)) {
        res.status(400).send("Bad Request - user doesn't exist");
      }

      let userFromDb = user.docs[0].data();

      //check if user stored in db already has an active subscription created
      if (userFromDb.hasOwnProperty(usersCollectionSubscriptionField)) {
        if (
          userFromDb[usersCollectionSubscriptionField][
            userCollectionSubscriptionDetailsPlanIdField
          ] == userPlanIdSelected
        ) {
          //send existing subscription url since there is no expiry set for any links
          res.send({
            subscriptionUrl:
              userFromDb[usersCollectionSubscriptionField][
                userCollectionSubscriptionDetailsShortUrlField
              ],
          });
          //update subscription plan if attempting for different plan that what is already created
        } else {
          const subscriptionStatusInDb =
            userFromDb[usersCollectionSubscriptionField][
              userCollectionSubscriptionDetailsStatusField
            ];

          //if user has on-going (not active) subscription, then call function to update data in db
          if (
            !isNullOrEmptyUtil(subscriptionStatusInDb) &&
            ![subscriptionStatusCreated, subscriptionStatusCancelled].includes(
              subscriptionStatusInDb
            )
          ) {
            /**
             * ABSTRACT CODEBLOCK
             * write code here to update views in firebase if required for upgraded or downgraded plan here
             */
          }

          let updateSubscritionRzpResponse = await updateSubscription(
            userFromDb[usersCollectionSubscriptionField][
              usersCollectionSubscriptionDetailsIdField
            ],
            userPlanIdSelected
          );

          if (
            !isNullOrEmptyUtil(updateSubscritionRzpResponse) &&
            !updateSubscritionRzpResponse.hasOwnProperty(
              razorpayErrorResponseKey
            )
          ) {
            //save subscription details in db
            let subscriptionUrl =
              updateSubscritionRzpResponse[
                userCollectionSubscriptionDetailsShortUrlField
              ];
            let usersSubscriptionUpdateObj = {};
            usersSubscriptionUpdateObj[usersCollectionSubscriptionField] =
              updateSubscritionRzpResponse;

            usersSubscriptionUpdateObj[usersCollectionSubscriptionIdField] =
              updateSubscritionRzpResponse[
                usersCollectionSubscriptionDetailsIdField
              ];

            await firestoreAdmin
              .collection(usersCollectionName)
              .doc(userId)
              .update(usersSubscriptionUpdateObj);

            res.send({
              subscriptionUrl:
                updateSubscritionRzpResponse[
                  userCollectionSubscriptionDetailsShortUrlField
                ],
            });
          } else {
            res
              .status(500)
              .send(
                "error updating subscription for user" +
                  !isNullOrEmptyUtil(updateSubscritionRzpResponse)
                  ? updateSubscritionRzpResponse[razorpayErrorResponseKey]
                  : ""
              );
          }
        }

        //if no subscription exists for user, create new subscription
      } else {
        //user details for payment-notification
        let userPhone = userFromDb[usersCollectionPhoneField];
        let userEmail = userFromDb[usersCollectionEmailField];

        let createSubscriptionResponse = await createSubscription(
          userPlanIdSelected,
          userPhone,
          userEmail
        );

        if (
          !isNullOrEmptyUtil(createSubscriptionResponse) &&
          !createSubscriptionResponse.hasOwnProperty(razorpayErrorResponseKey)
        ) {
          //save subscription details in db
          let usersSubscriptionUpdateObj = {};
          usersSubscriptionUpdateObj[usersCollectionSubscriptionField] =
            createSubscriptionResponse;

          usersSubscriptionUpdateObj[usersCollectionSubscriptionIdField] =
            createSubscriptionResponse[
              usersCollectionSubscriptionDetailsIdField
            ];
          await firestoreAdmin
            .collection(usersCollectionName)
            .doc(userId)
            .update(usersSubscriptionUpdateObj);

          res.send({
            subscriptionUrl:
              createSubscriptionResponse[
                userCollectionSubscriptionDetailsShortUrlField
              ],
          });
        } else {
          res
            .status(500)
            .send(
              "error creating subscription for user" +
                !isNullOrEmptyUtil(createSubscriptionResponse)
                ? createSubscriptionResponse[razorpayErrorResponseKey]
                : ""
            );
        }
      }
    } catch (err) {
      res
        .status(500)
        .send("Internal Server Error occurred: " + JSON.stringify(obj));
    }
  });
});

/**
 * cancel subscription for user if exists
 * if pending dues is calculated, then subscription is not cancelled, rather an order will be created to clear dues first and order-id sent back which can be used by front-end to trigger razorpay payment popup
 * if no pending dues then subscription is attempted to be cancelled immedietly
 *
 *  NOTE:
 * Request Params required in URL - userId
 * /checkAndCancelSubscription?userId=4tID2qzCVePJ3tpL0wUw92TghLe2
 *
 * RESPONSE:
 * there are 2 scenarions to be considered
 * 1. in case there are no pending dues to be paid by customer for extra views
 * returns json object with just 'msg' key - contains success message
 *
 * 2. in case pending dues exists for customer, in which create order-id and return to front-end to make immediate payment
 * returns json object with just 'orderId' key containing order-id
 */
exports.checkAndCancelSubscription = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    //validate user email and planType passed in query param
    //query parameter constants
    const userIdQueryParamKey = "userId";

    if (
      !req.query.hasOwnProperty(userIdQueryParamKey) &&
      isNullOrEmptyUtil(req.query[userIdQueryParamKey])
    ) {
      res.status(400).send("Bad Request - please pass valid user id");
    }

    const userIdFrmQueryParam = req.query[userIdQueryParamKey];

    //fetch user by id
    const user = await firestoreAdmin
      .collection(usersCollectionName)
      .where(usersCollectionUserIdField, "==", userIdFrmQueryParam)
      .limit(1)
      .get();

    //validate if user exists by such email
    if (checkIfArrayNullOrEmpty(user.docs)) {
      res.status(400).send("Bad Request - user doesn't exist");
    }

    let userFromDb = user.docs[0].data();

    //if no subscription details present then send bad-request error
    if (
      !userFromDb.hasOwnProperty(usersCollectionSubscriptionField) &&
      !userFromDb[usersCollectionSubscriptionField].hasOwnProperty(
        usersCollectionSubscriptionDetailsIdField
      ) &&
      isNullOrEmptyUtil(
        userFromDb[usersCollectionSubscriptionField][
          usersCollectionSubscriptionDetailsIdField
        ]
      )
    ) {
      res
        .status(400)
        .send("Bad Request - no subscription details available for the user");
    }

    let pendingCost = 0;
    let pendingCostMsg = "";

    /**ABSTRACT CODEBLOCK
     * calculate pending dues for user here from firestore here
     * update pending cost and msg here
     */

    //if in above code-block pending dues calculated for user is zero then cancel subscription immedieatly
    const subscriptionId =
      userFromDb[usersCollectionSubscriptionField][
        usersCollectionSubscriptionDetailsIdField
      ];
    if (pendingCost == 0) {
      let cancelSubscriptionRzpResponse = await cancelSubscription(
        subscriptionId
      );

      if (
        !isNullOrEmptyUtil(cancelSubscriptionRzpResponse) &&
        !cancelSubscriptionRzpResponse.hasOwnProperty(razorpayErrorResponseKey)
      ) {
        //save subscription details in db
        let usersSubscriptionUpdateObj = {};
        usersSubscriptionUpdateObj[usersCollectionSubscriptionField] =
          cancelSubscriptionRzpResponse;

        await firestoreAdmin
          .collection(usersCollectionName)
          .doc(userIdFrmQueryParam)
          .update(usersSubscriptionUpdateObj);

        res.send({
          msg: "subscription cancelled successfully, no pending dues for the user",
        });
      } else {
        res
          .status(500)
          .send(
            "error cancelling subscription for user" +
              !isNullOrEmptyUtil(cancelSubscriptionRzpResponse)
              ? cancelSubscriptionRzpResponse[razorpayErrorResponseKey]
              : ""
          );
      }
      /**
       * if pending dues exist for the user then create an order to make instantaneous payment of pending dues
       * this order id is finally passed to front-end which will be used to trigger razorpay popup
       */
    } else {
      let orderCreateRzpResponse = await createOrderForInstantPayment(
        pendingCost,
        pendingCostMsg
      );

      if (
        !isNullOrEmptyUtil(orderCreateRzpResponse) &&
        !orderCreateRzpResponse.hasOwnProperty(razorpayErrorResponseKey)
      ) {
        //save pending dues order details in db
        let usersSubscriptionUpdateObj = {};
        usersSubscriptionUpdateObj[
          usersCollectionSubscriptionCancelDetailsField
        ] = orderCreateRzpResponse;

        await firestoreAdmin
          .collection(usersCollectionName)
          .doc(userIdFrmQueryParam)
          .update(usersSubscriptionUpdateObj);

        res.send({
          orderId:
            orderCreateRzpResponse[usersCollectionSubscriptionDetailsIdField],
        });
      } else {
        res
          .status(500)
          .send(
            "error creating order of pending dues for user: " +
              (!isNullOrEmptyUtil(orderCreateRzpResponse)
                ? orderCreateRzpResponse[razorpayErrorResponseKey]
                : "")
          );
      }
    }
  });
});

/**
 * Verify payment of user of pending dues in front-end modal and upon successful verification cancel user's subscription
 *
 * NOTE:
 * Request Body (JSON) required containing razorpay_order_id,razorpay_payment_id,razorpay_signature (basically return the response object from razor-pay model popup in front-end)
 * Request Query Params required - userId
 * /verifyPaymentAndCancelSubscription?userId=4tID2qzCVePJ3tpL0wUw92TghLe2
 * Expect 200 status with success message indicating successful payment verification and successful cancellation of subscription for the user
 */
exports.verifyPaymentAndCancelSubscription = functions.https.onRequest(
  (req, res) => {
    cors(req, res, async () => {
      const userIdQueryParamKey = "userId";
      const responseReqBodyKey = "response";
      const rzpOrderIdReqBodyKey = "razorpay_order_id";
      const rzpPaymentIdReqBodyKey = "razorpay_payment_id";
      const rzpSignatureReqBodyKey = "razorpay_signature";

      //Data Validation
      if (
        !req.query.hasOwnProperty(userIdQueryParamKey) ||
        isNullOrEmptyUtil(req.query[userIdQueryParamKey]) ||
        !req.body.hasOwnProperty(responseReqBodyKey) ||
        isNullOrEmptyUtil(req.body[responseReqBodyKey]) ||
        !req.body[responseReqBodyKey].hasOwnProperty(rzpOrderIdReqBodyKey) ||
        isNullOrEmptyUtil(req.body[responseReqBodyKey][razorpay_order_id]) ||
        !req.body[responseReqBodyKey].hasOwnProperty(rzpPaymentIdReqBodyKey) ||
        isNullOrEmptyUtil(
          req.body[responseReqBodyKey][rzpPaymentIdReqBodyKey]
        ) ||
        !req.body[responseReqBodyKey].hasOwnProperty(rzpSignatureReqBodyKey) ||
        isNullOrEmptyUtil(req.body[responseReqBodyKey][razorpay_signature])
      ) {
        res
          .status(400)
          .send(
            "Bad Request, please pass all required params and body || Request Body (JSON) required containing razorpay_order_id,razorpay_payment_id,razorpay_signature (basically return the response object from razor-pay model popup in front-end) and Request Query Params required - userId"
          );
      }

      //fetch user by id
      const userIdFrmQueryParam = req.query[userIdQueryParamKey];
      const user = await firestoreAdmin
        .collection(usersCollectionName)
        .where(usersCollectionUserIdField, "==", userIdFrmQueryParam)
        .limit(1)
        .get();

      //validate if user exists by such ID
      if (checkIfArrayNullOrEmpty(user.docs)) {
        res.status(400).send("Bad Request - user doesn't exist");
      }

      let userFromDb = user.docs[0].data();

      console.log("Payment Verification service called...");

      let body =
        req.body[responseReqBodyKey][rzpOrderIdReqBodyKey] +
        "|" +
        req.body[responseReqBodyKey][rzpPaymentIdReqBodyKey];

      let expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_API_SECRET)
        .update(body.toString())
        .digest("hex");

      console.log(
        "signature received ",
        req.body[responseReqBodyKey][rzpSignatureReqBodyKey]
      );
      console.log("signature generated ", expectedSignature);

      //If Payment Verification is Success cancel existing subscription of user
      if (
        expectedSignature ===
        req.body[responseReqBodyKey][rzpSignatureReqBodyKey]
      ) {
        try {
          const subscriptionId =
            userFromDb[usersCollectionSubscriptionDetailsIdField][
              usersCollectionSubscriptionDetailsIdField
            ];
          let cancelSubscriptionRzpResponse = await cancelSubscription(
            subscriptionId
          );

          if (
            !isNullOrEmptyUtil(cancelSubscriptionRzpResponse) &&
            !cancelSubscriptionRzpResponse.hasOwnProperty(
              razorpayErrorResponseKey
            )
          ) {
            //save subscription details in db
            let usersSubscriptionUpdateObj = {};
            usersSubscriptionUpdateObj[usersCollectionSubscriptionField] =
              cancelSubscriptionRzpResponse;

            await firestoreAdmin
              .collection(usersCollectionName)
              .doc(userIdFrmQueryParam)
              .update(usersSubscriptionUpdateObj);

            res.send({
              successMsg:
                "Payment Verification successsfully and subscription cancelled successfully!",
              success: true,
            });
          } else {
            res
              .status(201)
              .send(
                "Payment successfully verified but Razorpay Error occurred while cancellig subscription for user" +
                  !isNullOrEmptyUtil(cancelSubscriptionRzpResponse)
                  ? cancelSubscriptionRzpResponse[razorpayErrorResponseKey]
                  : ""
              );
          }
        } catch (err) {
          res
            .status(201)
            .send(
              "Payment successfully verified but Internal Server Error occurred while cancellig subscription for user" +
                err
            );
        }
      }
      //if payment not completed
      else {
        res.status(200).send({
          errorMsg: "Payment Verification failed, please complete payment",
          success: false,
        });
      }
    });
  }
);

/**
 * webhook used by razorpay to notify subscription stages
 * this api updates status of subscription of respective user
 * also saves latest subscription details sent by razorpay
 */
exports.updateSubscriptionStatusWebhook = functions.https.onRequest(
  (req, res) => {
    cors(req, res, async () => {
      try {
        const subscriptionId = req.body.payload.subscription.id;
        const subscriptionStatus = req.body.payload.subscription.status;
        const subscriptionDetailsObj = req.body.payload.subscription;

        const subscriptionStatusActivate = [
          subscriptionStatusAuthenticated,
          subscriptionStatusActive,
          subscriptionStatusUpdated,
          subscriptionStatusResumed,
        ];

        const subscriptionStatusDisable = [
          subscriptionStatusCompleted,
          subscriptionStatusPending,
          subscriptionStatusHalted,
          subscriptionStatusCancelled,
          subscriptionStatusPaused,
        ];

        const user = await firestoreAdmin
          .collection(usersCollectionName)
          .where(usersCollectionSubscriptionIdField, "==", subscriptionId)
          .limit(1)
          .get();

        //proceed if user exists by such subscription-id
        if (!checkIfArrayNullOrEmpty(user.docs)) {
          //update subscription details for user in DB
          let userFromDb = user.docs[0].data();

          let userId = userFromDb[usersCollectionUserIdField];

          let userSubscriptionStatusUpdateObj = {};

          //set subscription-enabled field
          if (subscriptionStatusActivate.includes(subscriptionStatus)) {
            userSubscriptionStatusUpdateObj[
              usersCollectionSubscriptionEnabledField
            ] = true;
          } else if (subscriptionStatusDisable.includes(subscriptionStatus)) {
            userSubscriptionStatusUpdateObj[
              usersCollectionSubscriptionEnabledField
            ] = false;
          }

          //set subscription details field
          userSubscriptionStatusUpdateObj[usersCollectionSubscriptionField] =
            subscriptionDetailsObj;

          //update in db
          await firestoreAdmin
            .collection(usersCollectionName)
            .doc(userIdFrmQueryParam)
            .update(userSubscriptionStatusUpdateObj);
        }
      } catch (err) {}
      res.status(200).send("success");
    });
  }
);

/**
 * API to addon monthly additional view expenses to subscription for users
 * also stores add on response from razorpay in user db as subscriptionAddOnHistory
 * NOTE:
 * required - request-body (userId, amount, notes)
 * expect response - 200 with response object from razorpay
 */
exports.subscriptionAddOns = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    const userIdReqBodyKey = "userId";
    const amountReqBodyKey = "amount";
    const notesReqBodyKey = "notes";

    //validation
    if (
      !req.body.hasOwnProperty(userIdReqBodyKey) ||
      isNullOrEmptyUtil(req.body[userIdReqBodyKey]) ||
      !req.body.hasOwnProperty(amountReqBodyKey) ||
      isNullOrEmptyUtil(req.body[amountReqBodyKey])
    ) {
      res
        .status(400)
        .send(
          "Please pass all valid required parameters i.e userId and amount in query parameters of the API"
        );
    }

    //Request body values
    const userId = req.body[userIdReqParamKey];
    const addOnAmount = req.body[amountReqBodyKey];
    const notes = req.body.hasOwnProperty(notesReqBodyKey)
      ? req.body[notesReqBodyKey]
      : "";

    const user = await firestoreAdmin
      .collection(usersCollectionName)
      .where(usersCollectionUserIdField, "==", userId)
      .limit(1)
      .get();

    //user details from db
    let userFromDb = user.docs[0].data();

    //validate user id
    if (checkIfArrayNullOrEmpty(user.docs)) {
      res
        .status(400)
        .send("user doesnt exist with passed id, please pass valid user id");
    }

    //check if subscription details exists for user
    if (
      !userFromDb.hasOwnProperty(usersCollectionSubscriptionField) ||
      isNullOrEmptyUtil([userFromDb][usersCollectionSubscriptionField]) ||
      !userFromDb.hasOwnProperty(usersCollectionSubscriptionIdField) ||
      isNullOrEmptyUtil([userFromDb][usersCollectionSubscriptionIdField])
    ) {
      res
        .status(500)
        .send(
          "Subscription details doesn't exist or invalid for user in database"
        );
    }

    const subscriptionId = userFromDb[usersCollectionSubscriptionIdField];

    let subscriptionAddOnRzpResponse = createSubscriptionAddOn(
      subscriptionId,
      addOnAmount,
      notes
    );

    //if successful add ons added to subscription
    if (
      !isNullOrEmptyUtil(subscriptionAddOnRzpResponse) &&
      !subscriptionAddOnRzpResponse.hasOwnProperty(razorpayErrorResponseKey)
    ) {
      let addOnUpdateValue = [];

      if (
        userFromDb.hasOwnProperty(
          usersCollectionSubscriptionAddOnHistoryField
        ) &&
        !checkIfArrayNullOrEmpty(
          userFromDb[usersCollectionSubscriptionAddOnHistoryField]
        )
      ) {
        addOnUpdateValue =
          userFromDb[usersCollectionSubscriptionAddOnHistoryField];
      }

      addOnUpdateValue.push(subscriptionAddOnRzpResponse);

      let userUpdateObj = {};
      userUpdateObj[usersCollectionSubscriptionAddOnHistoryField] =
        addOnUpdateValue;

      //update in db
      await firestoreAdmin
        .collection(usersCollectionName)
        .doc(userId)
        .update(userUpdateObj);

      res.status(200).send(subscriptionAddOnRzpResponse);
    }
    //if addon failure
    else {
      res
        .status(500)
        .send(
          "Razorpay Error occurred while add on in subscription for user" +
            !isNullOrEmptyUtil(cancelSubscriptionRzpResponse)
            ? subscriptionAddOnRzpResponse[razorpayErrorResponseKey]
            : ""
        );
    }
  });
});

//Razorpay Utils
function createSubscription(razorpayPlanId, userPhone, userEmail) {
  //Set subscription date 30 days later to enable free trial
  let subscriptionStartDate = new Date();
  subscriptionStartDate.setDate(subscriptionStartDate.getDate() + 30);

  let subscriptionStartDateUnixTimeStamp = Math.floor(
    subscriptionStartDate / 1000
  );

  return razorpayInstance.subscriptions.create({
    //Base Plan Id for the subscription
    plan_id: razorpayPlanId,

    //Notify customer or not (0 - false, 1 - true)
    customer_notify: 1,

    //pass customer contact details if you set customer_notify as true
    notify_info: {
      notify_phone: userPhone,
      notify_email: userEmail,
    },

    //Qty of items (1 since they can only have one subscription at a time)
    quantity: 1,

    //total no of billing cycles - 12 times in a year
    total_count: 12,

    //subscription starts at (pass millisec value of date)- optional
    start_at: subscriptionStartDateUnixTimeStamp,
  });
}

function updateSubscription(razorpaySubscriptionId, razorpayNewPlanId) {
  return razorpayInstance.subscriptions.update(razorpaySubscriptionId, {
    //Base Plan Id for the subscription
    plan_id: razorpayNewPlanId,

    //scheduled update of subscription - do it immedietly
    schedule_change_at: subscriptionScheduleChangeAtNow,
  });
}

function cancelSubscription(razorpaySubscriptionId) {
  return razorpayInstance.subscriptions.cancel(razorpaySubscriptionId);
}

function createSubscriptionAddOn(
  razorpaySubscriptionId,
  subscriptionAddOnAmount,
  subscriptionAddOnNotes
) {
  //INR RUPEE to PAISE conversion
  subscriptionAddOnAmount = subscriptionAddOnAmount * 100;

  subscriptionAddOnNotes = isNullOrEmptyUtil(subscriptionAddOnNotes)
    ? "Monthly Additional Views Add On"
    : subscriptionAddOnNotes;

  return razorpayInstance.subscriptions.createAddon(razorpaySubscriptionId, {
    item: {
      name: subscriptionAddOnNotes,
      amount: subscriptionAddOnAmount,
      currency: "INR",
      description: "monthly subscription add ons ",
    },
  });
}

function createOrderForInstantPayment(orderAmount, orderNotes) {
  //INR RUPEE to PAISE conversion
  orderAmount = orderAmount * 100;

  //create order in razorpay
  return razorpayInstance.orders.create({
    amount: orderAmount,
    currency: "INR",
    notes: {
      msg: orderNotes,
    },
  });
}

//Code Utils
function isNullOrEmptyUtil(nullCheckValue) {
  if (nullCheckValue) {
    if (typeof nullCheckValue === "string") {
      if (nullCheckValue.trim()) {
        return false;
      } else {
        return true;
      }
    } else {
      return false;
    }
  } else {
    return true;
  }
}

function checkIfArrayNullOrEmpty(arr) {
  return (
    arr == null ||
    arr == undefined ||
    (arr != null && arr != undefined && !(arr.length > 0))
  );
}

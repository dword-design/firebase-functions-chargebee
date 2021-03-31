import { first, invoke, omit, property } from '@dword-design/functions'
import chargebee from 'chargebee'
import * as firebase from 'firebase-admin'
import * as functions from 'firebase-functions'

const collectionName = 'chargebeeCustomers'
firebase.initializeApp()
chargebee.configure({
  api_key: functions.config().chargebee.api_key,
  site: functions.config().chargebee.site_name,
})

export const userCreated = functions.auth.user().onCreate(async user => {
  const customer =
    chargebee.customer.create({ email: user.email }).request()
    |> await
    |> property('customer')
  await firebase
    .firestore()
    .collection(collectionName)
    .doc(user.uid)
    .set({ customerId: customer.id, ...(customer |> omit('id')) })
})

export const userDeleted = functions.auth.user().onDelete(async user => {
  const customer =
    firebase.firestore().collection(collectionName).doc(user.uid).get()
    |> await
    |> invoke('data')
  // If you use the `delete-user-data` extension it could be the case that the customer record is already deleted.
  // In that case, the `onCustomerDataDeleted` function below takes care of deleting the Stripe customer object.
  if (customer) {
    await chargebee.customer.delete(customer.customerId).request()
  }
})

export const customerDeleted = functions.firestore
  .document(`/${collectionName}/{userId}`)
  .onDelete(async snapshot => {
    const customer = snapshot.data()
    await chargebee.customer.delete(customer.customerId).request()
  })

export const webHook = functions.https.onRequest(async (req, res) => {
  functions.logger.log(req.body.event_type)
  switch (req.body.event_type) {
    case 'subscription_created':
    case 'subscription_changed':
    case 'subscription_reactivated': {
      const customer = req.body.content.customer

      const subscription = req.body.content.subscription

      const userId =
        firebase
          .firestore()
          .collection(collectionName)
          .where('customerId', '==', customer.id)
          .get()
        |> await
        |> property('docs')
        |> first
        |> property('id')
      await firebase
        .firestore()
        .collection(collectionName)
        .doc(userId)
        .collection('subscriptions')
        .doc(subscription.id)
        .set(subscription)
      break
    }
    case 'subscription_deleted':
    case 'subscription_cancelled': {
      const customer = req.body.content.customer

      const subscription = req.body.content.subscription

      const userId =
        firebase
          .firestore()
          .collection(collectionName)
          .where('customerId', '==', customer.id)
          .get()
        |> await
        |> property('docs')
        |> first
        |> property('id')
      await firebase
        .firestore()
        .collection(collectionName)
        .doc(userId)
        .collection('subscriptions')
        .doc(subscription.id)
        .delete()
      break
    }
    default:
  }

  return res.end()
})
